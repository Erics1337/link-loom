// LinkLoom - Clustering Service
// Handles the multi-pass analysis logic using an LLM

export class ClusteringService {
    constructor(llmApiKey) {
        this.apiKey = llmApiKey;
        // Using a generic endpoint, could be OpenAI or Gemini
        this.llmEndpoint = 'https://api.openai.com/v1/chat/completions';
    }

    /**
     * Main entry point for the multi-pass clustering algorithm
     * @param {Array} bookmarks - List of bookmarks with 'content' (from Firecrawl)
     * @param {string} granularity - 'low', 'medium', 'high'
     * @param {Function} onProgress - Callback (message)
     */
    async organize(bookmarks, granularity, onProgress) {
        // Pass 2: Dynamic Clustering
        const targetCategoryCount = this._calculateTargetCategories(bookmarks.length, granularity);

        if (onProgress) onProgress('Designing folder structure...');
        const structure = await this._generateStructure(bookmarks, targetCategoryCount);

        // Pass 3: Assignment
        if (onProgress) onProgress('Assigning bookmarks to folders...');
        const organizedBookmarks = await this._assignBookmarksToStructure(bookmarks, structure, onProgress);

        return organizedBookmarks;
    }

    _calculateTargetCategories(total, granularity) {
        const ratios = {
            'low': 0.05,    // 1 category per 20 bookmarks
            'medium': 0.1,  // 1 category per 10 bookmarks
            'high': 0.2     // 1 category per 5 bookmarks
        };
        const ratio = ratios[granularity] || ratios['medium'];
        return Math.max(3, Math.ceil(total * ratio)); // Minimum 3 categories
    }

    async _generateStructure(bookmarks, targetCount) {
        // Prepare a summary of content for the LLM
        // We truncate content to avoid token limits
        const summaries = bookmarks.map(bm => {
            return `- ID: ${bm.id}, URL: ${bm.url}, Title: ${bm.title}, ContentSnippet: ${bm.content.substring(0, 500)}...`;
        }).join('\n');

        const prompt = `
      You are an expert information architect.
      Analyze the following list of bookmarks and their content summaries.
      Create a hierarchical folder structure to organize them.
      
      Constraints:
      1. Aim for approximately ${targetCount} main categories.
      2. Create sub-categories ONLY if they will contain 2 or more items. Do NOT create a folder for a single bookmark.
      3. Avoid deep nesting. Flatter is better.
      4. The structure should be semantic and intuitive.
      5. Do NOT use generic names like "Miscellaneous", "Other", or "General" unless absolutely impossible to categorize otherwise.
      6. Create specific categories (e.g., "Winter Sports" or "Weather" instead of "Misc") even for small groups if they are distinct.
      
      Return ONLY valid JSON in this format:
      {
        "categories": [
          { "title": "Category Name", "children": [ { "title": "Sub-category" } ] }
        ]
      }

      Bookmarks:
      ${summaries}
    `;

        const response = await this._callLLM(prompt, true);
        // Handle both array (legacy/mock) and object (LLM json_object mode)
        if (Array.isArray(response)) return response;
        if (response && response.categories && Array.isArray(response.categories)) return response.categories;
        return []; // Fallback
    }

    async _assignBookmarksToStructure(bookmarks, structure, onProgress) {
        const CHUNK_SIZE = 10;
        let allMappings = {};

        // Process in chunks
        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            const chunk = bookmarks.slice(i, i + CHUNK_SIZE);
            const currentBatch = Math.floor(i / CHUNK_SIZE) + 1;
            const totalBatches = Math.ceil(bookmarks.length / CHUNK_SIZE);

            if (onProgress) {
                onProgress(`Assigning bookmarks... (Batch ${currentBatch}/${totalBatches})`);
            }

            const summaries = chunk.map(bm => `${bm.id}: ${bm.title} (Content: ${bm.content.substring(0, 100)}...)`).join('\n');
            const structureJson = JSON.stringify(structure);

            const prompt = `
            Given the following folder structure:
            ${structureJson}

            And this list of bookmarks with content snippets:
            ${summaries}

            Assign EVERY single bookmark ID from the list above to the most appropriate folder path.
            ALSO, generate a concise, descriptive "new_title" for each bookmark based on its content and context.
            AND, extract 3-5 relevant "tags" or keywords for the bookmark.
            
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
                // We use a shorter timeout for smaller chunks if needed, but 60s is fine
                const mapping = await this._callLLM(prompt, true);

                // Merge mapping
                if (mapping) {
                    // Handle potential nested structure from LLM or direct object
                    // The prompt asks for { id: { path, new_title, tags } }
                    // Sometimes LLMs wrap in a root key like "assignments"
                    const actualMapping = mapping.assignments || mapping;
                    Object.assign(allMappings, actualMapping);
                }
            } catch (error) {
                console.error(`Batch ${currentBatch} failed:`, error);
                // Continue to next batch, these bookmarks will fall to "Recovered"
            }
        }

        // Reconstruct the full tree with bookmarks inserted
        return this._buildFinalTree(structure, bookmarks, allMappings);
    }

    async _callLLM(prompt, expectJson = false) {
        if (!this.apiKey) {
            console.log('LLM API Key missing, returning mock response');
            return this._getMockLLMResponse(expectJson);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for LLM

            const response = await fetch(this.llmEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini", // Use a fast, capable model
                    messages: [
                        { role: "system", content: "You are a helpful assistant that organizes bookmarks. Return only JSON." },
                        { role: "user", content: prompt }
                    ],
                    response_format: expectJson ? { type: "json_object" } : undefined
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`LLM API Error: ${response.status} ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;

            if (expectJson) {
                return JSON.parse(content);
            }
            return content;

        } catch (error) {
            console.error('LLM Call Failed:', error);
            // Re-throw the error so the UI can show it
            throw error;
        }
    }

    _buildFinalTree(structure, bookmarks, mapping) {
        // Deep clone structure
        // Ensure structure is an array
        let finalTree = Array.isArray(structure) ? JSON.parse(JSON.stringify(structure)) : [];
        if (!Array.isArray(structure) && structure.categories) {
            finalTree = JSON.parse(JSON.stringify(structure.categories));
        }

        // Create a map for quick folder lookup
        // We need to traverse the tree to find where to put things
        // For simplicity, we'll assume the structure is 2 levels deep max for now
        // or we just search for the title.

        // Helper to find a node by title (BFS)
        const findNodeByTitle = (nodes, title) => {
            if (!nodes || !Array.isArray(nodes)) return null;
            for (const node of nodes) {
                if (node.title === title) return node;
                if (node.children) {
                    const found = findNodeByTitle(node.children, title);
                    if (found) return found;
                }
            }
            return null;
        };

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
                targetFolder = findNodeByTitle(finalTree, folderName);
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
                let misc = findNodeByTitle(finalTree, "General") || findNodeByTitle(finalTree, "Miscellaneous");
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
        return this._optimizeTree(finalTree);
    }

    _optimizeTree(nodes) {
        if (!nodes || !Array.isArray(nodes)) return [];

        const optimizedNodes = [];

        for (const node of nodes) {
            // If it's a bookmark (leaf), just keep it
            if (node.url) {
                optimizedNodes.push(node);
                continue;
            }

            // It's a folder
            if (node.children) {
                // 1. Optimize children first (bottom-up)
                node.children = this._optimizeTree(node.children);

                // 2. Check if this folder is now "lonely" (contains only 1 bookmark)
                if (node.children.length === 1 && node.children[0].url) {
                    // Replace this folder with its single child
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
}
