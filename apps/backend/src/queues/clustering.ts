import { Job } from 'bullmq';
import { supabase } from '../db';
import { kmeans } from 'ml-kmeans';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface ClusteringJobData {
    userId: string;
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
            for (const bid of bookmarkIds) {
                await supabase.from('cluster_assignments').insert({
                    cluster_id: parentId,
                    bookmark_id: bid,
                });
            }
        }
        return;
    }

    // K-Means
    const k = Math.min(5, bookmarkIds.length);
    const result = kmeans(vectors, k, { initialization: 'kmeans++' });

    // Group by cluster
    const groups: { [key: number]: { ids: string[]; vecs: number[][] } } = {};
    for (let i = 0; i < result.clusters.length; i++) {
        const clusterIdx = result.clusters[i];
        if (!groups[clusterIdx]) groups[clusterIdx] = { ids: [], vecs: [] };
        groups[clusterIdx].ids.push(bookmarkIds[i]);
        groups[clusterIdx].vecs.push(vectors[i]);
    }

    // Process each group
    for (const key in groups) {
        const group = groups[key];

        // Generate Name
        const name = await generateClusterName(group.ids);

        const { data: newCluster } = await supabase
            .from('clusters')
            .insert({
                user_id: userId,
                name,
                parent_id: parentId,
            })
            .select()
            .single();

        if (newCluster) {
            // Recurse
            await recursiveCluster(group.ids, group.vecs, newCluster.id, userId);
        }
    }
}

async function generateClusterName(bookmarkIds: string[]): Promise<string> {
    // Fetch titles
    const { data: bks } = await supabase
        .from('bookmarks')
        .select('title, description')
        .in('id', bookmarkIds.slice(0, 10));

    if (!bks || bks.length === 0) return 'New Folder';

    const prompt = `Generate a short, descriptive folder name (max 3 words) for a bookmark folder containing these items:\n` +
        bks.map(b => `- ${b.title}: ${b.description}`).join('\n');

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
        });
        return response.choices[0].message.content?.trim() || 'New Folder';
    } catch (e) {
        return 'New Folder';
    }
}

export const clusteringProcessor = async (job: Job<ClusteringJobData>) => {
    const { userId } = job.data;
    console.log(`Clustering bookmarks for user ${userId}`);

    // Fetch all embedded bookmarks for user with their vectors via join
    const { data: userBookmarks } = await supabase
        .from('bookmarks')
        .select(`
            id,
            shared_links!content_hash (vector)
        `)
        .eq('user_id', userId);

    if (!userBookmarks || userBookmarks.length === 0) return;

    // Filter out bookmarks without vectors
    const validBookmarks = userBookmarks.filter(b => 
        b.shared_links && (b.shared_links as any).vector
    );

    if (validBookmarks.length === 0) return;

    const ids = validBookmarks.map(b => b.id);
    const vectors = validBookmarks.map(b => (b.shared_links as any).vector as number[]);

    // Start Recursion
    await recursiveCluster(ids, vectors, null, userId);
};
