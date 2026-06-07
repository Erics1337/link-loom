import { describe, expect, it } from 'vitest';
import { countSnapshotAssignments } from '../backups';

describe('countSnapshotAssignments', () => {
    it('reads Supabase aggregate count shape', () => {
        expect(countSnapshotAssignments([{ count: 12 }])).toBe(12);
    });

    it('sums counts across multiple assignment objects', () => {
        expect(countSnapshotAssignments([{ count: 3 }, { count: 5 }])).toBe(8);
    });

    it('counts assignment rows when count fields are absent', () => {
        expect(countSnapshotAssignments([
            { bookmark_id: 'bookmark-1' },
            { bookmark_id: 'bookmark-2' },
            { bookmark_id: 'bookmark-3' },
        ])).toBe(3);
    });
});
