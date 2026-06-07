import { describe, expect, it } from 'vitest';
import { createEmptyProgress } from '../processingSession';

describe('processingSession', () => {
    it('creates an empty progress object with every counter initialized', () => {
        expect(createEmptyProgress()).toEqual({
            pending: 0,
            pendingRaw: 0,
            enriched: 0,
            embedded: 0,
            errored: 0,
            processing: 0,
            remainingToAssign: 0,
            clusters: 0,
            assigned: 0,
            total: 0,
            isIngesting: false,
            ingestProcessed: 0,
            ingestTotal: 0,
            isClusteringActive: false,
        });
    });
});
