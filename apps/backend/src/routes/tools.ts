import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { generateBookmarkRename } from '../lib/bookmarkRename';
import { normalizeClusteringSettings } from '../lib/clusteringSettings';
import { isDeadBookmarkUrl } from '../lib/deadLinks';
import { createLimit } from '../lib/limit';
import { fetchAllPages } from '../lib/supabasePages';
import { requirePremium, requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema, userIdParamsSchema } from './schemas';

const DEAD_LINK_SCAN_DEADLINE_MS = 30_000;

type DeadLinksBody = {
    bookmarks?: unknown;
};

export const registerToolRoutes = async (fastify: FastifyInstance) => {
    fastify.post('/dead-links/check', {
        schema: {
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['scanned', 'dead', 'skipped', 'deadChromeIds'],
                    properties: {
                        scanned: { type: 'number' },
                        dead: { type: 'number' },
                        skipped: { type: 'number' },
                        deadChromeIds: { type: 'array', items: { type: 'string' } },
                    },
                },
                401: errorResponseSchema,
                402: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const hasPremium = await requirePremium(userId, reply);
        if (!hasPremium) return reply;

        const body = req.body as DeadLinksBody;
        const rawBookmarks = Array.isArray(body?.bookmarks) ? body.bookmarks : [];
        const bookmarks = rawBookmarks
            .map((item: any) => ({
                chromeId: typeof item?.chromeId === 'string' ? item.chromeId : '',
                url: typeof item?.url === 'string' ? item.url : ''
            }))
            .filter((item: any) => item.chromeId && item.url);

        if (bookmarks.length === 0) {
            return { scanned: 0, dead: 0, skipped: 0, deadChromeIds: [] };
        }

        const chromeIdsByUrl = new Map<string, string[]>();
        for (const bookmark of bookmarks) {
            const key = bookmark.url.trim();
            if (!key) continue;
            const existing = chromeIdsByUrl.get(key);
            if (existing) {
                existing.push(bookmark.chromeId);
            } else {
                chromeIdsByUrl.set(key, [bookmark.chromeId]);
            }
        }

        const uniqueUrls = Array.from(chromeIdsByUrl.keys());
        console.log(`[DEAD_LINKS] Checking ${uniqueUrls.length} unique URLs (from ${bookmarks.length} bookmarks)`);

        const deadUrlSet = new Set<string>();
        const deadLinkCheckLimit = createLimit(50);
        let deadlinePassed = false;
        let scannedCount = 0;

        const deadlineTimer = setTimeout(() => {
            deadlinePassed = true;
        }, DEAD_LINK_SCAN_DEADLINE_MS);

        const promises = uniqueUrls.map((url) =>
            deadLinkCheckLimit(async () => {
                if (deadlinePassed) return;
                try {
                    const isDead = await isDeadBookmarkUrl(url);
                    if (isDead) deadUrlSet.add(url);
                } catch {
                    // Swallow per-URL errors.
                }
                scannedCount++;
            })
        );

        await Promise.all(promises);
        clearTimeout(deadlineTimer);

        const skipped = uniqueUrls.length - scannedCount;
        const deadChromeIds = Array.from(deadUrlSet).flatMap((url) => chromeIdsByUrl.get(url) ?? []);
        console.log(`[DEAD_LINKS] Done: scanned=${scannedCount}, dead=${deadChromeIds.length}, skipped=${skipped}`);
        return {
            scanned: scannedCount,
            dead: deadChromeIds.length,
            skipped,
            deadChromeIds
        };
    });

    fastify.post('/auto-rename/:userId', {
        schema: {
            params: userIdParamsSchema,
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        renamed: { type: 'number' },
                        scanned: { type: 'number' },
                        failed: { type: 'number' },
                        updates: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    },
                },
                401: errorResponseSchema,
                402: errorResponseSchema,
                403: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const body = req.body as { clusteringSettings?: unknown };
        const clusteringSettings = normalizeClusteringSettings(body?.clusteringSettings);
        const hasPremium = await requirePremium(userId, reply);
        if (!hasPremium) return reply;

        let assignments: any[] = [];
        try {
            assignments = await fetchAllPages<any>((from, to) =>
                supabase
                    .from('cluster_assignments')
                    .select(`
                        bookmark_id,
                        clusters!inner (user_id, name),
                        bookmarks!inner (id, title, ai_title, description, url)
                    `)
                    .eq('clusters.user_id', userId)
                    .order('bookmark_id', { ascending: true })
                    .range(from, to)
            );
        } catch (assignmentError) {
            console.error('[AUTO_RENAME] Failed to load assignments', assignmentError);
            return reply.code(500).send({ error: 'Failed to load bookmarks for rename' });
        }

        const contextByBookmarkId = new Map<string, any>();
        for (const assignment of assignments ?? []) {
            const bookmark = Array.isArray(assignment.bookmarks)
                ? assignment.bookmarks[0]
                : assignment.bookmarks;
            const cluster = Array.isArray(assignment.clusters)
                ? assignment.clusters[0]
                : assignment.clusters;
            if (!bookmark?.id) continue;

            contextByBookmarkId.set(bookmark.id, {
                bookmarkId: bookmark.id,
                currentTitle: bookmark.title,
                currentAiTitle: bookmark.ai_title,
                description: bookmark.description,
                url: bookmark.url,
                clusterName: cluster?.name ?? null,
            });
        }

        const contexts = Array.from(contextByBookmarkId.values());
        if (contexts.length === 0) {
            return { renamed: 0, scanned: 0, updates: [] };
        }

        const renameLimit = createLimit(6);
        const updates: Array<{ bookmark_id: string; ai_title: string }> = [];
        const updateErrors: string[] = [];

        await Promise.all(
            contexts.map((context) =>
                renameLimit(async () => {
                    const suggestedTitle = await generateBookmarkRename({
                        currentTitle: context.currentTitle,
                        description: context.description,
                        url: context.url,
                        clusterName: context.clusterName,
                        namingTone: clusteringSettings.namingTone,
                        useEmojiNames: clusteringSettings.useEmojiNames,
                    });

                    const currentTitle = (context.currentTitle || '').trim();
                    const currentAiTitle = (context.currentAiTitle || '').trim();
                    const normalizedSuggestion = (suggestedTitle || '').trim();

                    if (!normalizedSuggestion) return;
                    if (normalizedSuggestion === currentAiTitle) return;
                    if (normalizedSuggestion === currentTitle && !currentAiTitle) return;

                    const { error: updateError } = await supabase
                        .from('bookmarks')
                        .update({ ai_title: normalizedSuggestion })
                        .eq('id', context.bookmarkId);

                    if (updateError) {
                        updateErrors.push(context.bookmarkId);
                        return;
                    }

                    updates.push({ bookmark_id: context.bookmarkId, ai_title: normalizedSuggestion });
                })
            )
        );

        return {
            renamed: updates.length,
            scanned: contexts.length,
            failed: updateErrors.length,
            updates,
        };
    });
};
