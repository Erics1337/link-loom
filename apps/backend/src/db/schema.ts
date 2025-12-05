import { pgTable, uuid, text, boolean, timestamp, primaryKey, customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[], driverData: string }>({
    dataType() {
        return 'vector';
    },
    toDriver(value: number[]): string {
        return JSON.stringify(value);
    },
    fromDriver(value: string): number[] {
        return JSON.parse(value);
    },
});

export const users = pgTable('users', {
    id: uuid('id').primaryKey(), // Supabase Auth ID
    email: text('email').unique(),
    isPremium: boolean('is_premium').default(false),
    createdAt: timestamp('created_at').defaultNow(),
});

export const bookmarks = pgTable('bookmarks', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    chromeId: text('chrome_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    aiTitle: text('ai_title'),
    description: text('description'),
    contentHash: text('content_hash'),
    status: text('status').default('pending'), // pending, enriched, embedded, error
    createdAt: timestamp('created_at').defaultNow(),
});

export const bookmarkEmbeddings = pgTable('bookmark_embeddings', {
    bookmarkId: uuid('bookmark_id').references(() => bookmarks.id, { onDelete: 'cascade' }).primaryKey(),
    vector: vector('vector'),
});

export const sharedLinks = pgTable('shared_links', {
    id: text('id').primaryKey(), // SHA-256 hash of URL
    url: text('url').notNull(),
    vector: vector('vector'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const clusters = pgTable('clusters', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    name: text('name'),
    parentId: uuid('parent_id'), // Self-reference handled in logic or raw SQL if needed
    createdAt: timestamp('created_at').defaultNow(),
});

export const clusterAssignments = pgTable('cluster_assignments', {
    clusterId: uuid('cluster_id').references(() => clusters.id).notNull(),
    bookmarkId: uuid('bookmark_id').references(() => bookmarks.id).notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.clusterId, t.bookmarkId] }),
}));
