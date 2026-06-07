import { describe, expect, it } from 'vitest';
import { normalizeVector } from '../clustering/vectorParsing';

describe('normalizeVector', () => {
    it('returns the original vector when the norm is effectively zero', () => {
        const vector = [1e-12, 0, 0];
        expect(normalizeVector(vector)).toBe(vector);
    });

    it('normalizes non-degenerate vectors to unit length', () => {
        const normalized = normalizeVector([3, 4]);
        expect(normalized[0]).toBeCloseTo(0.6);
        expect(normalized[1]).toBeCloseTo(0.8);
    });
});
