import { describe, expect, it } from 'vitest';
import { extractPrimaryDomainLabel } from '../textLabels';

describe('extractPrimaryDomainLabel', () => {
    it('returns null for missing or invalid URLs', () => {
        expect(extractPrimaryDomainLabel(null)).toBeNull();
        expect(extractPrimaryDomainLabel(undefined)).toBeNull();
        expect(extractPrimaryDomainLabel('')).toBeNull();
        expect(extractPrimaryDomainLabel('not-a-url')).toBeNull();
    });

    it('uses registrable domain for multi-part public suffixes', () => {
        expect(
            extractPrimaryDomainLabel('https://www.bbc.co.uk/news')
        ).toBe('bbc');
        expect(
            extractPrimaryDomainLabel('https://shop.example.co.uk')
        ).toBe('example');
    });

    it('handles common single-suffix domains and bare hostnames', () => {
        expect(extractPrimaryDomainLabel('https://www.github.com')).toBe(
            'github'
        );
        expect(extractPrimaryDomainLabel('https://localhost')).toBe(
            'localhost'
        );
    });
});
