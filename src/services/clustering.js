// LinkLoom - Clustering Service
// Handles the multi-pass analysis logic using an LLM

import { EmbeddingService } from './embeddings.js';
import { KMeans } from '../utils/kmeans.js';

export class ClusteringService {
    constructor(llmApiKey) {
        this.apiKey = llmApiKey;
        // Using a generic endpoint, could be OpenAI or Gemini
        this.llmEndpoint = 'https://api.openai.com/v1/chat/completions';
        this.embeddingService = new EmbeddingService(llmApiKey);
    }

    /**
     * Main entry point for the multi-pass clustering algorithm
     * @param {Array} bookmarks - List of bookmarks with 'content' (from Firecrawl)
     * @param {number|string} targetCountOrGranularity - Target number of categories OR 'low'/'medium'/'high'
     * @param {Function} onProgress - Callback (message)
     * @param {AbortSignal} signal - Signal to abort operation
     */
    async organize(bookmarks, targetCountOrGranularity, onProgress, signal) {
        console.log(`[ClusteringService] Starting organization for ${bookmarks.length} bookmarks (Target: ${targetCountOrGranularity})`);

        if (signal?.aborted) throw new Error('Aborted');

        // 1. Calculate Target Clusters
        const targetCategoryCount = this._calculateTargetCategories(bookmarks.length, targetCountOrGranularity);

        // 2. Generate Embeddings
        if (onProgress) onProgress('Understanding content (Generating Embeddings)...', { current: 10, total: 100 });
        const embeddings = await this._generateEmbeddings(bookmarks, onProgress, signal);

        if (signal?.aborted) throw new Error('Aborted');

        // 3. Cluster with K-Means
        if (onProgress) onProgress('Grouping similar items...', { current: 50, total: 100 });
        const { clusters, centroids } = this._clusterBookmarks(embeddings, targetCategoryCount);

        // 4. Label Clusters (LLM)
        if (onProgress) onProgress('Naming categories...', { current: 70, total: 100 });
        const initialStructure = await this._labelClusters(clusters, bookmarks, signal);

        // 5. Hierarchical Refinement (Subfolders & Titles)
        if (onProgress) onProgress('Creating subfolders & refining...', { current: 85, total: 100 });

        // Map embeddings by ID for easy lookup during recursion
        const embeddingMap = new Map();
        bookmarks.forEach((bm, i) => embeddingMap.set(bm.id, embeddings[i]));

        const finalStructure = await this._refineStructure(initialStructure, embeddingMap, signal, 0, onProgress);

        console.log('[ClusteringService] Organization complete.');
        return finalStructure;
    }

    async _refineStructure(nodes, embeddingMap, signal, depth = 0, onProgress) {
        let processedCount = 0;
        const totalNodes = nodes.length;
        const CONCURRENCY_LIMIT = 5;

        const processNode = async (node) => {
            if (signal?.aborted) throw new Error('Aborted');

            // Progress Update
            processedCount++;
            if (onProgress && depth === 0) {
                onProgress(`Refining categories... (${processedCount}/${totalNodes})`, {
                    current: 85 + Math.floor((processedCount / totalNodes) * 10),
                    total: 100
                });
            }

            // Logic
            if (node.children && node.children.length > 5 && depth < 1) {
                console.log(`[ClusteringService] Sub-clustering category: ${node.title} (${node.children.length} items)`);
                const subEmbeddings = node.children.map(bm => embeddingMap.get(bm.id));
                const k = Math.max(2, Math.ceil(Math.sqrt(node.children.length)));
                const { clusters } = this._clusterBookmarks(subEmbeddings, k);
                const subStructure = await this._labelClusters(clusters, node.children, signal);

                // Recurse
                node.children = await this._refineStructure(subStructure, embeddingMap, signal, depth + 1, onProgress);
                return node;
            } else if (node.children && node.children.length > 0) {
                // Leaf
                node.children = await this._refineBookmarks(node.children, node.title, signal);
                return node;
            } else {
                return node;
            }
        };

        // Execute with concurrency limit
        const results = [];
        const executing = [];

        for (const node of nodes) {
            if (signal?.aborted) throw new Error('Aborted');

            const p = processNode(node);
            results.push(p);

            if (CONCURRENCY_LIMIT <= nodes.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= CONCURRENCY_LIMIT) {
                    await Promise.race(executing);
                }
            }
        }

        return Promise.all(results);
    }

    async _generateEmbeddings(bookmarks, onProgress, signal) {
        // Prepare text for embedding: Title + URL + Content Snippet
        const texts = bookmarks.map(bm => {
            const contentSnippet = bm.content ? bm.content.substring(0, 500) : '';
            return `Title: ${bm.title}\nURL: ${bm.url}\nContent: ${contentSnippet}`;
        });

        return await this.embeddingService.fetchEmbeddings(texts, signal);
    }

    _clusterBookmarks(embeddings, k) {
        const kmeans = new KMeans(k);
        return kmeans.run(embeddings);
    }

    async _labelClusters(clusters, bookmarks, signal) {
        const labeledCategories = [];

        // Process each cluster to generate a name
        // We can do this in parallel batches
        const promises = clusters.map(async (clusterIndices, index) => {
            if (clusterIndices.length === 0) return null;

            const clusterBookmarks = clusterIndices.map(i => bookmarks[i]);

            // Generate prompt with sample items
            const samples = clusterBookmarks.slice(0, 10).map(bm => `- ${bm.title} (${bm.url})`).join('\n');
            const prompt = `
            Analyze this group of bookmarks and provide a short, descriptive Category Name.
            
            Rules:
            1. Name must be generic (e.g., "Development", "News", "Shopping").
            2. Avoid "Misc" or "Other".
            3. Return ONLY the category name string.

            Bookmarks:
            ${samples}
            `;

            const categoryName = await this._callLLM(prompt, false, signal);
            const cleanCategoryName = categoryName.replace(/"/g, '').trim();

            return {
                title: cleanCategoryName,
                children: clusterBookmarks
            };
        });

        const results = await Promise.all(promises);
        return results.filter(r => r !== null);
    }

    async _refineBookmarks(bookmarks, categoryName, signal) {
        const refined = [];
        const CHUNK_SIZE = 20;
        const CONCURRENCY_LIMIT = 3;

        // Create chunks
        const chunks = [];
        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            chunks.push(bookmarks.slice(i, i + CHUNK_SIZE));
        }

        const processChunk = async (chunk) => {
            if (signal?.aborted) throw new Error('Aborted');
            const summaries = chunk.map(bm => `${bm.id}: ${bm.title} (${bm.url})`).join('\n');

            const prompt = `
            Context: Category "${categoryName}"
            
            For each bookmark below:
            1. Generate a concise, descriptive "new_title" (better than the original).
            2. Extract 3-5 tags.
            
            Return JSON object with a "bookmarks" array:
            {
                "bookmarks": [
                    { "id": "bookmark_id", "new_title": "...", "tags": [...] }
                ]
            }

            Bookmarks:
            ${summaries}
            `;

            try {
                const response = await this._callLLM(prompt, true, signal);
                const results = response.bookmarks || response.items || [];

                const resultMap = new Map();
                results.forEach(item => {
                    if (item.id) resultMap.set(String(item.id), item);
                });

                return chunk.map(bm => {
                    const info = resultMap.get(String(bm.id)) || {};
                    return {
                        ...bm,
                        suggestedTitle: info.new_title || bm.title,
                        tags: info.tags || []
                    };
                });
            } catch (e) {
                console.warn('Refinement failed for chunk, keeping originals', e);
                return chunk;
            }
        };

        // Execute chunks in parallel
        const results = [];
        const executing = [];

        for (const chunk of chunks) {
            if (signal?.aborted) throw new Error('Aborted');

            const p = processChunk(chunk);
            results.push(p);

            if (CONCURRENCY_LIMIT <= chunks.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= CONCURRENCY_LIMIT) {
                    await Promise.race(executing);
                }
            }
        }

        const chunkResults = await Promise.all(results);
        return chunkResults.flat();
    }

    _calculateTargetCategories(total, input) {
        // If input is a specific number, use it
        if (typeof input === 'number') {
            return Math.max(1, Math.min(50, input));
        }

        // Fallback for legacy string inputs
        const ratios = {
            'low': 0.05,    // 1 category per 20 bookmarks
            'medium': 0.1,  // 1 category per 10 bookmarks
            'high': 0.2,    // 1 category per 5 bookmarks
            'broad': 0.05,
            'specific': 0.2
        };
        const ratio = ratios[input] || ratios['medium'];
        return Math.max(3, Math.ceil(total * ratio)); // Minimum 3 categories
    }

    async _generateStructure(bookmarks, targetCount, signal) {
        console.log(`[ClusteringService] Generating structure (Target Categories: ${targetCount})`);

        if (signal?.aborted) throw new Error('Aborted');

        // Optimization: Sample to stay within token limits (200k TPM).
        // Dynamic sampling based on total bookmarks
        let SAMPLE_SIZE = 450;
        if (bookmarks.length > 2000) SAMPLE_SIZE = 1000;
        else if (bookmarks.length > 1000) SAMPLE_SIZE = 750;

        let sampleBookmarks = bookmarks;

        if (bookmarks.length > SAMPLE_SIZE) {
            // Shuffle and take sample
            const shuffled = [...bookmarks].sort(() => 0.5 - Math.random());
            sampleBookmarks = shuffled.slice(0, SAMPLE_SIZE);
            console.log(`Sampling ${SAMPLE_SIZE} bookmarks out of ${bookmarks.length} for structure generation.`);
        }

        // Prepare a summary of content for the LLM
        // Optimized for token efficiency: 150 chars snippet
        const summaries = sampleBookmarks.map(bm => {
            return `- ${bm.title} (${bm.url}): ${bm.content.substring(0, 150).replace(/\n/g, ' ')}...`;
        }).join('\n');

        const prompt = `
      You are an expert information architect.
      Analyze the following list of bookmarks (a representative sample) and their content summaries.
      Create a hierarchical folder structure to organize them.
      
      CRITICAL RULES:
      1. Aim for approximately ${targetCount} main categories.
      2. Create sub-categories ONLY if they will contain 2 or more items. Do NOT create a folder for a single bookmark.
      3. Avoid deep nesting. Flatter is better.
      4. The structure should be semantic and intuitive.
      5. Do NOT use generic names like "Miscellaneous", "Other", or "General" unless absolutely impossible to categorize otherwise.
      6. Create specific categories (e.g., "Winter Sports" or "Weather" instead of "Misc") even for small groups if they are distinct.
      7. **FOLDER NAMES MUST BE GENERAL CATEGORIES, NOT SPECIFIC EXAMPLES**:
         - Use "Artists" NOT "Banksy" or "Picasso"
         - Use "Programming Languages" NOT "Python" or "JavaScript"
         - Use "Cities" NOT "Paris" or "Tokyo"
         - Use "Companies" NOT "Google" or "Apple"
         - Think of the folder as a COLLECTION TYPE, not an individual item
      
      Return ONLY valid JSON in this format:
      {
        "categories": [
          { "title": "Category Name", "children": [ { "title": "Sub-category" } ] }
        ]
      }

      Bookmarks Sample:
      ${summaries}
    `;

        const response = await this._callLLM(prompt, true, signal);
        // Handle both array (legacy/mock) and object (LLM json_object mode)
        if (Array.isArray(response)) return response;
        if (response && response.categories && Array.isArray(response.categories)) return response.categories;
        return []; // Fallback
    }

    async _assignBookmarksToStructure(bookmarks, structure, granularity, onProgress, signal) {
        console.log('[ClusteringService] Starting bookmark assignment...');
        if (signal?.aborted) throw new Error('Aborted');

        const CHUNK_SIZE = 40; // Increased to 40 for speed
        const CONCURRENCY = 5; // Increased to 5 for speed
        let allMappings = {};

        // Create chunks
        const chunks = [];
        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            chunks.push(bookmarks.slice(i, i + CHUNK_SIZE));
        }

        const totalBatches = chunks.length;
        let completedBatches = 0;

        // Initial progress update
        if (onProgress) {
            onProgress(`Assigning bookmarks... (Batch 0/${totalBatches})`, { current: 0, total: totalBatches });
        }

        // Helper to process a single chunk
        const processChunk = async (chunk, index) => {
            if (signal?.aborted) throw new Error('Aborted');
            console.log(`[ClusteringService] Starting Batch ${index + 1}/${totalBatches}`);

            const summaries = chunk.map(bm => `${bm.id}: ${bm.title} (Content: ${bm.content.substring(0, 75).replace(/\n/g, ' ')}...)`).join('\n');
            const structureJson = JSON.stringify(structure);

            const prompt = `
            Given the following folder structure:
            ${structureJson}

            And this list of bookmarks with content snippets:
            ${summaries}

            FOR EVERY SINGLE BOOKMARK IN THE LIST:
            1. Assign it to the most appropriate folder path
            2. Generate a concise, descriptive "new_title" based on its content and context
            3. Extract 5-8 relevant "tags" or keywords
            
            CRITICAL: You MUST include ALL bookmark IDs from the input list in your response.
            CRITICAL: EVERY bookmark MUST have a "new_title" field - do not skip any.
            
            Return JSON object where keys are bookmark IDs and values are objects:
            { 
                "bookmark_id": { 
                    "path": ["Folder", "Subfolder"],
                    "new_title": "Better Title",
                    "tags": ["tag1", "tag2"]
                } 
            }
            `;

            try {
                const mapping = await this._callLLM(prompt, true, signal);
                if (mapping) {
                    const actualMapping = mapping.assignments || mapping;
                    Object.assign(allMappings, actualMapping);
                }
            } catch (error) {
                if (error.message === 'Aborted') throw error;
                console.error(`Batch ${index + 1} failed:`, error);
            } finally {
                completedBatches++;
                if (onProgress) {
                    onProgress(`Assigning bookmarks... (Batch ${completedBatches}/${totalBatches})`, { current: completedBatches, total: totalBatches });
                }
            }
        };

        // Process chunks with concurrency limit
        const results = [];
        const executing = [];

        for (let i = 0; i < chunks.length; i++) {
            if (signal?.aborted) break;

            const p = processChunk(chunks[i], i);
            results.push(p);

            if (CONCURRENCY <= chunks.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= CONCURRENCY) {
                    await Promise.race(executing);
                }
            }
        }

        await Promise.all(results);

        if (signal?.aborted) throw new Error('Aborted');

        // Reconstruct the full tree with bookmarks inserted
        return await this._buildFinalTree(structure, bookmarks, allMappings, granularity, onProgress);
    }

    async _callLLM(prompt, expectJson = false, signal) {
        if (signal?.aborted) throw new Error('Aborted');

        if (!this.apiKey) {
            console.log('LLM API Key missing, returning mock response');
            return this._getMockLLMResponse(expectJson);
        }

        console.log(`[ClusteringService] Calling LLM (Expect JSON: ${expectJson})`);

        let retries = 0;
        const MAX_RETRIES = 3;

        while (true) {
            if (signal?.aborted) throw new Error('Aborted');

            let controller = null;
            let timeoutId = null;

            try {
                controller = new AbortController();

                // Link the passed signal to this controller
                if (signal) {
                    signal.addEventListener('abort', () => controller.abort());
                }

                timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout (fail fast)

                const requestBody = {
                    model: "gpt-4o-mini", // Use a fast, capable model
                    messages: [
                        { role: "system", content: "You are a helpful assistant that organizes bookmarks. Return only JSON." },
                        { role: "user", content: prompt }
                    ],
                    response_format: expectJson ? { type: "json_object" } : undefined
                };

                // Race fetch against a hard timeout promise (double safety)
                const fetchPromise = fetch(this.llmEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Hard Timeout')), 65000);
                });

                const response = await Promise.race([fetchPromise, timeoutPromise]);

                clearTimeout(timeoutId);

                if (response.status === 429) {
                    if (retries >= MAX_RETRIES) {
                        throw new Error(`LLM Rate Limit Exceeded after ${MAX_RETRIES} retries.`);
                    }
                    retries++;
                    const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000; // Exponential backoff + jitter
                    console.warn(`[ClusteringService] Rate limited (429). Retrying in ${Math.round(delay)}ms...`);
                    await this._sleep(delay, signal);
                    continue; // Retry loop
                }

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('[ClusteringService] LLM API Error Response:', errorData);
                    throw new Error(`LLM API Error: ${response.status} ${errorData.error?.message || response.statusText}`);
                }

                const data = await response.json();
                console.log(`[ClusteringService] LLM Response Received (Tokens: ${data.usage?.total_tokens})`);

                const content = data.choices[0].message.content;

                if (expectJson) {
                    return JSON.parse(content);
                }
                return content;

            } catch (error) {
                if (timeoutId) clearTimeout(timeoutId);

                if (error.name === 'AbortError') {
                    if (signal?.aborted) throw new Error('Aborted');
                    console.error('LLM Call Timed Out');
                    throw new Error('Request timed out after 60 seconds');
                }

                // Network Error Retry Logic
                if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
                    if (retries >= MAX_RETRIES) {
                        throw new Error(`LLM Network Error after ${MAX_RETRIES} retries: ${error.message}`);
                    }
                    retries++;
                    const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
                    console.warn(`[ClusteringService] Network error. Retrying in ${Math.round(delay)}ms...`, error);
                    await this._sleep(delay, signal);
                    continue;
                }

                console.error('LLM Call Failed:', error);
                throw error;
            }
        }
    }

    async _buildFinalTree(structure, bookmarks, mapping, granularity, onProgress) {
        if (onProgress) onProgress('Building folder map...', { current: 0, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 50)); // Yield for UI

        // Deep clone structure
        // Ensure structure is an array
        let finalTree = Array.isArray(structure) ? JSON.parse(JSON.stringify(structure)) : [];
        if (!Array.isArray(structure) && structure.categories) {
            finalTree = JSON.parse(JSON.stringify(structure.categories));
        }

        // Create a map for quick folder lookup (Optimization)
        const folderMap = new Map();
        const mapFolders = (nodes) => {
            if (!nodes || !Array.isArray(nodes)) return;
            for (const node of nodes) {
                if (node.title) {
                    folderMap.set(node.title, node);
                }
                if (node.children) {
                    mapFolders(node.children);
                }
            }
        };
        mapFolders(finalTree);

        // Helper to find a node by title (O(1) Lookup)
        const findNodeByTitle = (title) => {
            return folderMap.get(title) || null;
        };

        if (onProgress) onProgress(`Inserting ${bookmarks.length} bookmarks...`, { current: 30, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 50)); // Yield for UI

        // If mapping is from the LLM, it might be { "bookmark_id": ["Folder", "Subfolder"] }
        // or just { "bookmark_id": "Folder" }

        const assignedIds = new Set();

        bookmarks.forEach(bm => {
            let targetFolder = null;
            const assignment = mapping[bm.id];
            let suggestedTitle = null;
            let tags = [];

            if (assignment) {
                // Handle new object format or legacy array/string format
                let folderPath = [];

                if (typeof assignment === 'object' && !Array.isArray(assignment) && assignment.path) {
                    // New format: { path: [], new_title: "", tags: [] }
                    folderPath = assignment.path;
                    suggestedTitle = assignment.new_title;
                    tags = assignment.tags || [];
                } else if (Array.isArray(assignment)) {
                    folderPath = assignment;
                } else {
                    folderPath = [assignment];
                }

                const folderName = Array.isArray(folderPath) ? folderPath[folderPath.length - 1] : folderPath;
                targetFolder = findNodeByTitle(folderName);
            }

            // Create a clone of the bookmark to modify
            const bmNode = { ...bm };
            if (suggestedTitle) {
                bmNode.suggestedTitle = suggestedTitle;
            }
            if (tags && tags.length > 0) {
                bmNode.tags = tags;
            }

            if (targetFolder) {
                if (!targetFolder.children) targetFolder.children = [];
                targetFolder.children.push(bmNode);
                assignedIds.add(bm.id);
            } else {
                // Fallback: Try to find a "General" or "Misc" folder, or create one
                // FIX: findNodeByTitle only takes 1 argument (the title)
                let misc = findNodeByTitle("General") || findNodeByTitle("Miscellaneous");
                if (!misc) {
                    // If no misc folder, put in the first main category
                    if (finalTree.length > 0) {
                        misc = finalTree[0];
                    }
                }

                if (misc) {
                    if (!misc.children) misc.children = [];
                    misc.children.push(bmNode);
                    assignedIds.add(bm.id);
                }
            }
        });

        // Final safety net: If any bookmarks were missed (e.g. mapping missing ID), add to a "Recovered" folder
        const unassigned = bookmarks.filter(bm => !assignedIds.has(bm.id));
        if (unassigned.length > 0) {
            finalTree.push({
                title: "Recovered Bookmarks",
                children: unassigned
            });
        }

        // Post-processing: Flatten single-item folders
        if (onProgress) onProgress('Cleaning up structure...', { current: 90, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 50)); // Yield for UI

        try {
            return this._optimizeTree(finalTree, granularity);
        } catch (e) {
            console.error('Tree optimization failed, returning unoptimized tree:', e);
            return finalTree;
        }
    }

    _optimizeTree(nodes, granularity, depth = 0, startTime = Date.now()) {
        if (!nodes || !Array.isArray(nodes)) return [];

        // Safety Break: Recursion Depth
        if (depth > 20) {
            console.warn('Max recursion depth reached in _optimizeTree');
            return nodes;
        }

        // Safety Break: Execution Time (2 seconds max)
        if (Date.now() - startTime > 2000) {
            console.warn('Optimization timed out (2s limit). Returning current state.');
            return nodes;
        }

        const optimizedNodes = [];

        for (const node of nodes) {
            // If it's a bookmark (leaf), just keep it
            if (node.url) {
                // Strip heavy content to avoid message size limits
                // Only keep essential fields
                const cleanNode = {
                    id: node.id,
                    title: node.title,
                    url: node.url,
                    parentId: node.parentId,
                    index: node.index,
                    dateAdded: node.dateAdded,
                    scrapeStatus: node.scrapeStatus,
                    suggestedTitle: node.suggestedTitle,
                    tags: node.tags,
                    originalTitle: node.originalTitle
                };
                optimizedNodes.push(cleanNode);
                continue;
            }

            // It's a folder
            if (node.children) {
                // 1. Optimize children first (bottom-up)
                // Pass startTime down
                node.children = this._optimizeTree(node.children, granularity, depth + 1, startTime);

                // 2. Check if this folder is now "lonely" (contains only 1 child)
                let shouldFlatten = true;

                // Check if we want high specificity
                const isHighGranularity = (typeof granularity === 'number' && granularity > 10) ||
                    granularity === 'high' ||
                    granularity === 'specific';

                if (isHighGranularity) {
                    // In high granularity, we prefer specificity.
                    shouldFlatten = false;
                }

                if (shouldFlatten && node.children.length === 1) {
                    // Replace this folder with its single child (flattening it)
                    optimizedNodes.push(node.children[0]);
                }
                // 3. Remove empty folders
                else if (node.children.length === 0) {
                    // Skip adding this folder
                    continue;
                }
                else {
                    // Keep the folder
                    optimizedNodes.push(node);
                }
            }
        }

        // 4. Sort Alphabetically
        if (depth === 0) {
            console.log(`Optimization completed in ${Date.now() - startTime}ms`);
        }

        optimizedNodes.sort((a, b) => {
            const aIsFolder = !a.url;
            const bIsFolder = !b.url;

            if (aIsFolder && !bIsFolder) return -1;
            if (!aIsFolder && bIsFolder) return 1;

            return (a.title || "").localeCompare(b.title || "");
        });

        return optimizedNodes;
    }

    _getMockLLMResponse(expectJson) {
        if (expectJson) {
            return {
                categories: [
                    {
                        title: "Development",
                        children: [
                            { title: "Frontend" },
                            { title: "Backend" }
                        ]
                    },
                    {
                        title: "News & Reading",
                        children: [
                            { title: "Tech" },
                            { title: "World" }
                        ]
                    },
                    {
                        title: "Lifestyle",
                        children: []
                    }
                ]
            };
        }
        return "Mock LLM Response";
    }

    _sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(new Error('Aborted'));
            const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('Aborted'));
            };
            if (signal) signal.addEventListener('abort', onAbort);
            const timer = setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
        });
    }
}
