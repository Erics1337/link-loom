import { describe, expect, it } from 'vitest';
import {
    getTerminalWeavingAction,
    shouldHydrateWeaving,
    shouldTriggerClusteringRecovery,
} from '../useWeaveRun';

describe('useWeaveRun status decisions', () => {
    it.each([
        ['completed', 'fetch-results'],
        ['failed', 'show-error'],
        ['cancelled', 'idle'],
        [null, 'fetch-results'],
    ] as const)('maps terminal %s runs to %s', (pipelineStatus, action) => {
        expect(getTerminalWeavingAction({ isDone: true, pipelineStatus })).toBe(action);
    });

    it('does not hydrate terminal runs into weaving even when they have pending work', () => {
        expect(shouldHydrateWeaving({
            isDone: true,
            pending: 1,
            total: 10,
        })).toBe(false);
    });

    it('hydrates active non-terminal runs into weaving', () => {
        expect(shouldHydrateWeaving({
            isDone: false,
            pending: 0,
            total: 10,
        })).toBe(true);
    });

    it('does not trigger clustering recovery for terminal runs', () => {
        expect(shouldTriggerClusteringRecovery({
            isDone: true,
            total: 10,
            pending: 0,
            isIngesting: false,
            isClusteringActive: false,
            clusters: 0,
            remainingToAssign: 10,
        }, false)).toBe(false);
    });

    it('triggers clustering recovery only for stalled non-terminal runs', () => {
        expect(shouldTriggerClusteringRecovery({
            isDone: false,
            total: 10,
            pending: 0,
            isIngesting: false,
            isClusteringActive: false,
            clusters: 0,
            remainingToAssign: 10,
        }, false)).toBe(true);

        expect(shouldTriggerClusteringRecovery({
            isDone: false,
            total: 10,
            pending: 0,
            isIngesting: false,
            isClusteringActive: false,
            clusters: 0,
            remainingToAssign: 10,
        }, true)).toBe(false);
    });
});
