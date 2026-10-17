import { afterEach, describe, expect, it, vi } from 'vitest';
import { excerpt, relativeTime } from '../src/ui/components/common';

describe('list previews', () => {
  it('cut at a whole word and say there is more', () => {
    expect(excerpt('In closed bookstore, tension is all built up winnie just admits she loves him, Holds', 70)).toBe(
      'In closed bookstore, tension is all built up winnie just admits she…',
    );
    expect(excerpt('Short note', 70)).toBe('Short note');
    expect(excerpt('Ends on a comma, then more words here', 16)).toBe('Ends on a comma…');
    expect(excerpt('line one\n\nline two', 70)).toBe('line one line two');
  });
});

describe('relative times', () => {
  afterEach(() => vi.useRealTimers());

  it('read like a person would say them', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 22, 0));
    expect(relativeTime(new Date(2026, 9, 16, 21, 30).toISOString())).toBe('30 min ago');
    expect(relativeTime(new Date(2026, 9, 15, 8, 0).toISOString())).toBe('yesterday');
    expect(relativeTime(new Date(2026, 9, 11, 9, 0).toISOString())).toBe('5 days ago');
    expect(relativeTime(new Date(2026, 8, 2, 9, 0).toISOString())).toMatch(/Sep\D*2|2\D*Sep/);
    expect(relativeTime(new Date(2025, 8, 2, 9, 0).toISOString())).toMatch(/2025/);
    expect(relativeTime(null)).toBe('never');
  });
});
