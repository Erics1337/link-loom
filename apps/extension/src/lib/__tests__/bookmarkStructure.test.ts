import { describe, expect, it } from 'vitest';
import {
    countDuplicateAssignments,
    normalizeBookmarkUrl
} from '../bookmarkStructure';
import { BookmarkRootTitle } from '../bookmarkImport';

describe('normalizeBookmarkUrl', () => {
    it('lowercases scheme and host and strips default ports', () => {
        expect(normalizeBookmarkUrl('HTTPS://Example.COM:443/Path')).toBe(
            'https://example.com/Path'
        );
    });

    it('strips fragments and trailing slashes', () => {
        expect(normalizeBookmarkUrl('https://example.com/docs/#section')).toBe(
            'https://example.com/docs'
        );
    });

    it('drops tracking params but keeps meaningful ones', () => {
        expect(
            normalizeBookmarkUrl(
                'https://example.com/article?utm_source=news&utm_medium=email&id=42&fbclid=abc'
            )
        ).toBe('https://example.com/article?id=42');
    });

    it('sorts remaining query params so ordering variants match', () => {
        expect(normalizeBookmarkUrl('https://example.com/?b=2&a=1')).toBe(
            normalizeBookmarkUrl('https://example.com/?a=1&b=2')
        );
    });

    it('returns trimmed input for unparseable urls', () => {
        expect(normalizeBookmarkUrl(' not-a-url ')).toBe('not-a-url');
    });
});

describe('countDuplicateAssignments', () => {
    const assignment = (url: string, chromeId: string) => ({
        bookmarkId: `b-${chromeId}`,
        chromeId,
        url,
        rootTitle: 'Bookmarks Bar' as BookmarkRootTitle
    });

    it('counts tracking-param variants of the same url as duplicates', () => {
        const duplicates = countDuplicateAssignments([
            assignment('https://example.com/post?utm_source=x', '1'),
            assignment('HTTPS://EXAMPLE.com/post', '2'),
            assignment('https://other.com', '3')
        ]);
        expect(duplicates).toBe(1);
    });
});
