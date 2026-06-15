import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supabase } from '../../../db';
import { ClusteringSettings } from '../../../lib/clusteringSettings';
import { refineSiblingGroupsWithLLM } from '../clusterRefinement';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('../../../db', () => ({
    supabase: {
        from: vi.fn()
    }
}));

vi.mock('openai', () => ({
    default: class MockOpenAI {
        chat = {
            completions: {
                create: mockCreate
            }
        };
    }
}));

const settings: ClusteringSettings = {
    folderDensity: 'medium',
    namingTone: 'clear',
    useEmojiNames: false
};

const createGroup = (prefix: string, count: number, x: number) => ({
    ids: Array.from({ length: count }, (_, index) => `${prefix}-${index}`),
    vecs: Array.from({ length: count }, () => [x, 0])
});

describe('clusterRefinement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.OPENAI_API_KEY = 'test-key';
    });

    it('applies safe LLM sibling labels and whole-group merges', async () => {
        const groups = [
            createGroup('ai-a', 12, 0),
            createGroup('ai-b', 12, 0.1)
        ];

        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
                data: groups.flatMap((group) =>
                    group.ids.slice(0, 5).map((id) => ({
                        id,
                        title: 'AI workflow guide',
                        description: 'Automation and agent tools',
                        url: 'https://example.com/ai'
                    }))
                ),
                error: null
            })
        });
        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            labels: [{ groupIndex: 0, name: 'AI Workflows' }],
                            merges: [
                                {
                                    sourceGroupIndex: 1,
                                    targetGroupIndex: 0,
                                    reason: 'duplicate AI tools topic'
                                }
                            ]
                        })
                    }
                }
            ]
        });

        const refined = await refineSiblingGroupsWithLLM(
            groups,
            settings,
            vi.fn()
        );

        expect(refined).toHaveLength(1);
        expect(refined[0].ids).toHaveLength(24);
        expect(refined[0].suggestedName).toBe('AI Workflows');
    });

    it('skips the LLM when the sibling group is below the configured threshold', async () => {
        const groups = [
            createGroup('small-a', 6, 0),
            createGroup('small-b', 6, 1)
        ];

        const refined = await refineSiblingGroupsWithLLM(
            groups,
            settings,
            vi.fn()
        );

        expect(refined).toBe(groups);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });
});
