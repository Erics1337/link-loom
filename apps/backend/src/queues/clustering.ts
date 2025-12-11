import { Job } from 'bullmq';
import { supabase } from '../db';
import { kmeans } from 'ml-kmeans';
import OpenAI from 'openai';
import pLimit from 'p-limit';

import fs from 'fs';
import path from 'path';

const logFile = path.resolve(process.cwd(), 'clustering-debug.log');

function log(msg: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    console.log(msg);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface ClusteringJobData {
    userId: string;
}

const limit = pLimit(10); // Concurrency limit

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateClusterName(bookmarkIds: string[]): Promise<string> {
    // Fetch titles
    const { data: bks } = await supabase
        .from('bookmarks')
        .select('title, description')
        .in('id', bookmarkIds.slice(0, 10));

    if (!bks || bks.length === 0) return 'New Folder';

    const prompt = `Generate a short, descriptive folder name (max 3 words) for a bookmark folder containing these items. DO NOT use quotes, markdown, or punctuation:\n` +
        bks.map(b => `- ${b.title}: ${b.description}`).join('\n');

    let retries = 0;
    const maxRetries = 5;
    let baseDelay = 200; // start 200ms

    while (retries < maxRetries) {
        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
            });
            let name = response.choices[0].message.content?.trim() || 'New Folder';
            // Clean up common artifacts just in case
            name = name.replace(/^["']|["']$/g, '').replace(/\*\*/g, '').trim();
            return name;
        } catch (e: any) {
            if (e.status === 429) {
                retries++;
                const wait = baseDelay * Math.pow(2, retries - 1);
                console.log(`OpenAI Rate Limit caused 429. Retrying in ${wait}ms...`);
                await delay(wait);
                continue;
            }
            console.error('OpenAI Error:', e);
            return 'New Folder';
        }
    }
    return 'New Folder';
}

// Recursive function to cluster bookmarks
async function recursiveCluster(
    bookmarkIds: string[],
    vectors: number[][],
    parentId: string | null,
    userId: string
) {
    // Base Case: If small enough, stop
    if (bookmarkIds.length <= 5) {
        if (parentId) {
            // Batch insert
            const assignments = bookmarkIds.map(bid => ({
                cluster_id: parentId,
                bookmark_id: bid,
            }));
            
            const { error } = await supabase
                .from('cluster_assignments')
                .insert(assignments);
                
            if (error) log(`Batch insert error: ${JSON.stringify(error)}`);
        }
        return;
    }

    // K-Means
    const k = Math.min(5, bookmarkIds.length);
    
    try {
        log(`Running k-means on ${bookmarkIds.length} items with k=${k}`);
        const result = kmeans(vectors, k, { initialization: 'kmeans++' });
        
        // Group by cluster
        const groups: { [key: number]: { ids: string[]; vecs: number[][] } } = {};
        for (let i = 0; i < result.clusters.length; i++) {
            const clusterIdx = result.clusters[i];
            if (!groups[clusterIdx]) groups[clusterIdx] = { ids: [], vecs: [] };
            groups[clusterIdx].ids.push(bookmarkIds[i]);
            groups[clusterIdx].vecs.push(vectors[i]);
        }

        // Process groups in parallel
        // Process groups in parallel
        // 1. Create Clusters (Limited Concurrency)
        const createdClusters = await Promise.all(
            Object.values(groups).map(group => 
                limit(async () => {
                    // Generate Name
                    const name = await generateClusterName(group.ids);
                    
                    const { data: newCluster, error } = await supabase
                        .from('clusters')
                        .insert({
                            user_id: userId,
                            name,
                            parent_id: parentId,
                        })
                        .select()
                        .single();
                    
                    if (error) {
                        log(`Error creating cluster: ${JSON.stringify(error)}`);
                        return null;
                    }
                    
                    return { newCluster, group };
                })
            )
        );

        // 2. Recurse (Release the limit slot before recursing)
        // Filter out nulls (failed creations) and parallelize recursion
        await Promise.all(
            createdClusters
                .filter(item => item !== null && item.newCluster)
                .map(async (item) => {
                    const { newCluster, group } = item!;
                    await recursiveCluster(group.ids, group.vecs, newCluster.id, userId);
                })
        );

    } catch (e: any) {
        log(`Clustering error: ${e}`);
    }
}

export const clusteringProcessor = async (job: Job<ClusteringJobData>) => {
    const { userId } = job.data;
    log(`Clustering bookmarks for user ${userId}`);

    // Fetch all embedded bookmarks for user with their vectors via join
    let userBookmarks: any[] = [];
    let from = 0;
    const size = 1000;
    
    while(true) {
        log(`Fetching bookmarks range ${from}-${from + size - 1}...`);
        const { data: chunk, error } = await supabase
            .from('bookmarks')
            .select(`
                id,
                shared_links!content_hash (vector)
            `)
            .eq('user_id', userId)
            .range(from, from + size - 1);

        if (error) {
            log(`DB Error ${JSON.stringify(error)}`);
            return;
        }
        
        if (!chunk || chunk.length === 0) break;
        
        userBookmarks = userBookmarks.concat(chunk);
        
        if (chunk.length < size) break;
        from += size;
    }

    if (!userBookmarks || userBookmarks.length === 0) {
        log('No user bookmarks found');
        return;
    }
    
    log(`Fetched ${userBookmarks.length} bookmarks from DB`);

    // Filter out bookmarks without vectors
    const validBookmarks = userBookmarks.filter(b => 
        b.shared_links && (b.shared_links as any).vector
    );
    log(`Valid bookmarks with vectors: ${validBookmarks.length}`);

    if (validBookmarks.length === 0) {
        log('No valid bookmarks with vectors found');
        return;
    }

    const ids = validBookmarks.map(b => b.id);
    const vectors = validBookmarks.map(b => {
        const v = (b.shared_links as any).vector;
        if (typeof v === 'string') {
            try {
                return JSON.parse(v);
            } catch (e) {
                log(`Failed to parse vector: ${e}`);
                return [];
            }
        }
        return v as number[];
    });

    // Start Recursion
    await recursiveCluster(ids, vectors, null, userId);
    log('Clustering completed');
};
