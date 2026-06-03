import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../db';
import { isUserCancelled } from '../cancellation';
import { queues } from '../queue';
import { notifyPipelineBookmarkTerminal } from '../pipelineCoordinator';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
        rpc: vi.fn(),
    },
}));

vi.mock('../cancellation', () => ({
    isUserCancelled: vi.fn(),
}));

vi.mock('../queue', () => ({
    queues: {
        clustering: { add: vi.fn() },
    },
}));

describe('pipelineCoordinator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (isUserCancelled as any).mockResolvedValue(false);
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { generation: 7 }, error: null }),
        });
        (supabase.rpc as any).mockResolvedValue({ data: true, error: null });
    });

    it('queues fresh clustering jobs by pipelineRunId without carrying jobGeneration', async () => {
        await notifyPipelineBookmarkTerminal(
            'user-1',
            undefined,
            'run-7',
            {
                folderDensity: 'more',
                namingTone: 'playful',
                organizationMode: 'topic',
                useEmojiNames: false,
            }
        );

        expect(queues.clustering.add).toHaveBeenCalledWith(
            'cluster',
            {
                userId: 'user-1',
                pipelineRunId: 'run-7',
                clusteringSettings: {
                    folderDensity: 'more',
                    namingTone: 'playful',
                    organizationMode: 'topic',
                    useEmojiNames: false,
                },
            },
            { jobId: 'cluster-user-1-run-run-7' }
        );
    });
});
