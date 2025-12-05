import { Job } from 'bullmq';
import { db } from '../db';
import { bookmarks, bookmarkEmbeddings, clusters, clusterAssignments } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
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
        // Create a leaf cluster (or just leave them in the parent if parent exists)
        // For now, let's assume we just assign them to the parent.
        // If parentId is null (top level) and we have few items, we might just make one folder.
        if (parentId) {
            for (const bid of bookmarkIds) {
                await db.insert(clusterAssignments).values({
                    clusterId: parentId,
                    bookmarkId: bid,
                });
            }
        }
        return;
    }

    // K-Means
    const k = Math.min(5, bookmarkIds.length); // Split into 5 or fewer
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

        // Create a new cluster (folder)
        // Generate Name
        const name = await generateClusterName(group.ids);

        const [newCluster] = await db.insert(clusters).values({
            userId,
            name,
            parentId,
        }).returning();

        // Recurse
        await recursiveCluster(group.ids, group.vecs, newCluster.id, userId);
    }
}

async function generateClusterName(bookmarkIds: string[]): Promise<string> {
    // Fetch titles
    const bks = await db.select({ title: bookmarks.title, description: bookmarks.description })
        .from(bookmarks)
        .where(inArray(bookmarks.id, bookmarkIds.slice(0, 10))); // Sample 10

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

    // Fetch all embedded bookmarks for user
    const userBookmarks = await db.select({
        id: bookmarks.id,
        vector: bookmarkEmbeddings.vector,
    })
        .from(bookmarks)
        .innerJoin(bookmarkEmbeddings, eq(bookmarks.id, bookmarkEmbeddings.bookmarkId))
        .where(eq(bookmarks.userId, userId));

    if (userBookmarks.length === 0) return;

    const ids = userBookmarks.map(b => b.id);
    const vectors = userBookmarks.map(b => b.vector as number[]);

    // Start Recursion
    await recursiveCluster(ids, vectors, null, userId);
};
