import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, userIdParamsSchema } from './schemas';

type PipelineRunRow = {
    id?: unknown;
    generation?: unknown;
    status?: unknown;
    totals?: unknown;
};

type StatusCounts = {
    totalBookmarks: number;
    pendingBookmarks: number;
    enrichedBookmarks: number;
    embeddedBookmarks: number;
    erroredBookmarks: number;
    assignedBookmarks: number;
    clusterCount: number;
};

const terminalPipelineStatuses = new Set(['completed', 'cancelled', 'failed']);

const statusDebugLoggingEnabled = () => process.env.DEBUG_STATUS === 'true';

const emptyCounts = (): StatusCounts => ({
    totalBookmarks: 0,
    pendingBookmarks: 0,
    enrichedBookmarks: 0,
    embeddedBookmarks: 0,
    erroredBookmarks: 0,
    assignedBookmarks: 0,
    clusterCount: 0,
});

const toNumber = (value: unknown, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getTotalsNumber = (run: PipelineRunRow | null | undefined, key: string) => {
    const totals = run?.totals;
    if (!totals || typeof totals !== 'object' || Array.isArray(totals)) return undefined;

    const value = (totals as Record<string, unknown>)[key];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const hasTotalsKey = (run: PipelineRunRow | null | undefined, key: string) => {
    const totals = run?.totals;
    return Boolean(
        totals &&
        typeof totals === 'object' &&
        !Array.isArray(totals) &&
        key in totals
    );
};

const normalizeStatusCounts = (data: unknown): StatusCounts => {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return emptyCounts();

    const counts = row as Record<string, unknown>;
    return {
        totalBookmarks: toNumber(counts.total_bookmarks),
        pendingBookmarks: toNumber(counts.pending_bookmarks),
        enrichedBookmarks: toNumber(counts.enriched_bookmarks),
        embeddedBookmarks: toNumber(counts.embedded_bookmarks),
        erroredBookmarks: toNumber(counts.errored_bookmarks),
        assignedBookmarks: toNumber(counts.assigned_bookmarks),
        clusterCount: toNumber(counts.cluster_count),
    };
};

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));

const buildStatusResponse = ({
    userId,
    currentRun,
    counts,
    isPremium,
    legacyIsDone,
}: {
    userId: string;
    currentRun: PipelineRunRow | null;
    counts: StatusCounts;
    isPremium: boolean;
    legacyIsDone?: boolean;
}) => {
    const pipelineStatus = currentRun?.status == null ? null : String(currentRun.status);
    const totalFromRun = getTotalsNumber(currentRun, 'total');
    const untrackedErrors = getTotalsNumber(currentRun, 'untrackedErrors') ?? 0;
    const total = totalFromRun ?? counts.totalBookmarks;
    const pendingRaw = counts.pendingBookmarks;
    const enriched = counts.enrichedBookmarks;
    const embedded = counts.embeddedBookmarks;
    const errored = counts.erroredBookmarks + untrackedErrors;
    const assigned = counts.assignedBookmarks;
    const clusters = counts.clusterCount;
    const processing = pendingRaw + enriched;
    const terminalProcessed = embedded + enriched + errored;
    const remainingToAssign = Math.max(embedded - assigned, 0);
    const isLegacy = !currentRun;
    const isRunning = pipelineStatus === 'running';
    const ingestCompleted = hasTotalsKey(currentRun, 'ingestCompletedAt');
    const isIngesting = isLegacy
        ? pendingRaw > 0
        : isRunning &&
            !ingestCompleted &&
            (pendingRaw > 0 || total > counts.totalBookmarks);
    const ingestProcessed = isIngesting
        ? clamp(counts.totalBookmarks, 0, total)
        : clamp(Math.max(total - pendingRaw, terminalProcessed), 0, total);
    const isClusteringActive = isLegacy
        ? processing === 0 && embedded > 0 && clusters === 0
        : isRunning &&
            processing === 0 &&
            embedded > 0 &&
            (clusters === 0 || remainingToAssign > 0);
    const isDone = currentRun
        ? terminalPipelineStatuses.has(pipelineStatus ?? '')
        : Boolean(legacyIsDone);

    if (statusDebugLoggingEnabled()) {
        console.log(
            `[STATUS] User ${userId}: run=${currentRun?.id ?? 'none'} status=${currentRun?.status ?? 'none'} generation=${currentRun?.generation ?? 'none'}, total=${total}, pending=${pendingRaw}, enriched=${enriched}, embedded=${embedded}, errored=${errored}, assigned=${assigned}, clusters=${clusters}, ingesting=${isIngesting}, ingestProcessed=${ingestProcessed}/${total}, clusteringActive=${isClusteringActive}`
        );
    }

    return {
        pending: processing,
        pendingRaw,
        enriched,
        embedded,
        errored,
        processing,
        remainingToAssign,
        total,
        clusters,
        assigned,
        isIngesting,
        ingestProcessed,
        ingestTotal: total,
        isClusteringActive,
        isDone,
        isPremium,
        pipelineRunId: currentRun?.id == null ? null : String(currentRun.id),
        pipelineGeneration: currentRun?.generation == null ? null : Number(currentRun.generation),
        pipelineStatus,
    };
};

const loadLegacyStatusCounts = async (userId: string) => {
    const [
        { count: totalCount, error: totalError },
        { count: pendingRawCount, error: pendingRawError },
        { count: enrichedCount, error: enrichedError },
        { count: embeddedCount, error: embeddedError },
        { count: erroredCount, error: erroredError },
        { count: clusterCount, error: clusterError },
        { count: assignedCount, error: assignmentError }
    ] = await Promise.all([
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId),
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'pending'),
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'enriched'),
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'embedded'),
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'error'),
        supabase
            .from('clusters')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId),
        supabase
            .from('cluster_assignments')
            .select('bookmark_id, clusters!inner(user_id)', { count: 'exact', head: true })
            .eq('clusters.user_id', userId)
    ]);

    if (totalError) console.error('[STATUS] Total Count Error:', totalError);
    if (pendingRawError) console.error('[STATUS] Pending Raw Count Error:', pendingRawError);
    if (enrichedError) console.error('[STATUS] Enriched Count Error:', enrichedError);
    if (embeddedError) console.error('[STATUS] Embedded Count Error:', embeddedError);
    if (erroredError) console.error('[STATUS] Errored Count Error:', erroredError);
    if (clusterError) console.error('[STATUS] Cluster Count Error:', clusterError);
    if (assignmentError) console.error('[STATUS] Assigned Count Error:', assignmentError);

    const counts = {
        totalBookmarks: totalCount ?? 0,
        pendingBookmarks: pendingRawCount ?? 0,
        enrichedBookmarks: enrichedCount ?? 0,
        embeddedBookmarks: embeddedCount ?? 0,
        erroredBookmarks: erroredCount ?? 0,
        assignedBookmarks: assignedCount ?? 0,
        clusterCount: clusterCount ?? 0,
    };
    const processingCount = counts.pendingBookmarks + counts.enrichedBookmarks;
    const remainingToAssign = Math.max(counts.embeddedBookmarks - counts.assignedBookmarks, 0);
    const isClusteringActive =
        processingCount === 0 &&
        counts.embeddedBookmarks > 0 &&
        counts.clusterCount === 0;

    return {
        counts,
        isDone:
            processingCount === 0 &&
            counts.clusterCount > 0 &&
            !isClusteringActive &&
            remainingToAssign === 0,
    };
};

export const registerStatusRoutes = async (fastify: FastifyInstance) => {
    fastify.get('/status/:userId', {
        schema: {
            params: userIdParamsSchema,
            response: {
                200: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'pending',
                        'pendingRaw',
                        'enriched',
                        'embedded',
                        'errored',
                        'processing',
                        'remainingToAssign',
                        'total',
                        'clusters',
                        'assigned',
                        'isIngesting',
                        'ingestProcessed',
                        'ingestTotal',
                        'isClusteringActive',
                        'isDone',
                        'isPremium',
                        'pipelineRunId',
                        'pipelineGeneration',
                        'pipelineStatus',
                    ],
                    properties: {
                        pending: { type: 'number' },
                        pendingRaw: { type: 'number' },
                        enriched: { type: 'number' },
                        embedded: { type: 'number' },
                        errored: { type: 'number' },
                        processing: { type: 'number' },
                        remainingToAssign: { type: 'number' },
                        total: { type: 'number' },
                        clusters: { type: 'number' },
                        assigned: { type: 'number' },
                        isIngesting: { type: 'boolean' },
                        ingestProcessed: { type: 'number' },
                        ingestTotal: { type: 'number' },
                        isClusteringActive: { type: 'boolean' },
                        isDone: { type: 'boolean' },
                        isPremium: { type: 'boolean' },
                        pipelineRunId: { type: ['string', 'null'] },
                        pipelineGeneration: { type: ['number', 'null'] },
                        pipelineStatus: { type: ['string', 'null'] },
                    },
                },
                401: errorResponseSchema,
                403: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;

        const [
            { data: user },
            { data: control, error: controlError },
            { data: latestRun, error: latestRunError },
        ] = await Promise.all([
            supabase
                .from('users')
                .select('is_premium')
                .eq('id', userId)
                .maybeSingle(),
            supabase
                .from('user_pipeline_controls')
                .select('current_pipeline_run_id')
                .eq('user_id', userId)
                .maybeSingle(),
            supabase
                .from('pipeline_runs')
                .select('id, generation, status, started_at, cancelled_at, completed_at, settings, totals, error_summary')
                .eq('user_id', userId)
                .order('generation', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const isPremium = user?.is_premium ?? false;

        if (controlError) console.error('[STATUS] Pipeline Control Error:', controlError);
        if (latestRunError) console.error('[STATUS] Latest Run Error:', latestRunError);

        const controlRunId = control?.current_pipeline_run_id == null
            ? null
            : String(control.current_pipeline_run_id);
        let currentRun = latestRun as PipelineRunRow | null;

        if (controlRunId && controlRunId !== latestRun?.id) {
            const { data: controlRun, error: controlRunError } = await supabase
                .from('pipeline_runs')
                .select('id, generation, status, started_at, cancelled_at, completed_at, settings, totals, error_summary')
                .eq('id', controlRunId)
                .eq('user_id', userId)
                .maybeSingle();

            if (controlRunError) console.error('[STATUS] Current Run Error:', controlRunError);
            if (controlRun) currentRun = controlRun as PipelineRunRow;
        }

        if (!currentRun?.id) {
            const legacy = await loadLegacyStatusCounts(userId);
            return buildStatusResponse({
                userId,
                currentRun: null,
                counts: legacy.counts,
                isPremium,
                legacyIsDone: legacy.isDone,
            });
        }

        const { data: runCounts, error: runCountsError } = await supabase.rpc(
            'get_pipeline_run_status_counts',
            {
                p_user_id: userId,
                p_pipeline_run_id: currentRun.id,
            }
        );

        if (runCountsError) {
            console.error('[STATUS] Run Counts Error:', runCountsError);
            return reply
                .code(500)
                .send({ error: 'Failed to load run status counts' });
        }

        return buildStatusResponse({
            userId,
            currentRun,
            counts: normalizeStatusCounts(runCounts),
            isPremium,
        });
    });
};
