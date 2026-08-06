import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    NotionApiError,
    appendImageBlocks,
    appendTextBlocks,
    buildProperties,
    clampUrl,
    fetchDatabaseSchema,
    toRichText,
} from './notionClient';
import type { DatabaseSchema } from './types';

const SCHEMA: DatabaseSchema = {
    titleProperty: 'Title',
    urlProperty: 'Link',
    descriptionProperty: 'Description',
    tagsProperty: 'Tags',
    highlightsProperty: 'Highlights',
    sessionIdProperty: 'Session ID',
    tagOptions: [],
};

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('toRichText', () => {
    it('splits text into 2000 character objects', () => {
        const chunks = toRichText('x'.repeat(4500));
        expect(chunks).toHaveLength(3);
        expect(chunks[0].text.content).toHaveLength(2000);
        expect(chunks[2].text.content).toHaveLength(500);
    });

    it('returns an empty array for empty text', () => {
        expect(toRichText('')).toEqual([]);
    });

    it('never exceeds the 100 object array limit', () => {
        expect(toRichText('x'.repeat(2000 * 150)).length).toBe(100);
    });
});

describe('buildProperties', () => {
    it('falls back to the URL when the page has no title', () => {
        const props = buildProperties(SCHEMA, {
            url: 'https://a.test',
            title: '',
            description: '',
            tags: [],
        });
        expect(props.Title).toEqual({ title: [{ text: { content: 'https://a.test' } }] });
    });

    it('skips columns the database does not have', () => {
        const minimal: DatabaseSchema = {
            ...SCHEMA,
            descriptionProperty: null,
            tagsProperty: null,
            highlightsProperty: null,
        };
        const props = buildProperties(minimal, {
            url: 'https://a.test',
            title: 'T',
            description: 'note',
            tags: ['x'],
            highlights: 'quote',
        });
        expect(Object.keys(props)).toEqual(['Title', 'Link']);
    });

    it('deduplicates tags so Notion does not reject the payload', () => {
        const props = buildProperties(SCHEMA, {
            url: 'https://a.test',
            title: 'T',
            description: '',
            tags: ['article', 'article', 'news'],
        });
        expect(props.Tags).toEqual({
            multi_select: [{ name: 'article' }, { name: 'news' }],
        });
    });

    it('splits comma separated tags, which Notion rejects inside one option', () => {
        const props = buildProperties(SCHEMA, {
            url: 'https://a.test',
            title: 'T',
            description: '',
            tags: ['react, hooks'],
        });
        expect(props.Tags).toEqual({
            multi_select: [{ name: 'react' }, { name: 'hooks' }],
        });
    });

    it('clamps an over-long URL to the value Notion accepts', () => {
        const longUrl = `https://a.test/?q=${'x'.repeat(2100)}`;
        const props = buildProperties(SCHEMA, {
            url: longUrl,
            title: 'T',
            description: '',
            tags: [],
        });
        expect(props.Link).toEqual({ url: clampUrl(longUrl) });
        expect(clampUrl(longUrl)).toHaveLength(2000);
    });

    it('writes highlights when the column exists', () => {
        const props = buildProperties(SCHEMA, {
            url: 'https://a.test',
            title: 'T',
            description: '',
            tags: [],
            highlights: 'selected sentence',
        });
        expect(props.Highlights).toEqual({
            rich_text: [{ text: { content: 'selected sentence' } }],
        });
    });
});

describe('appendBlocks', () => {
    it('drops external images Notion cannot resolve instead of failing the batch', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ object: 'list' }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await appendImageBlocks('key', 'page', [
            'https://a.test/photo.png',
            'https://cdn.test/image?id=1',
        ]);

        expect(result).toEqual({ appended: 1, skipped: 1 });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body)).children).toHaveLength(1);
    });

    it('retries a rejected batch block by block so one bad block cannot discard the rest', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ code: 'validation_error' }, 400))
            .mockResolvedValueOnce(jsonResponse({ object: 'list' }))
            .mockResolvedValueOnce(jsonResponse({ code: 'validation_error' }, 400));
        vi.stubGlobal('fetch', fetchMock);

        const result = await appendTextBlocks('key', 'page', 'first\nsecond');

        expect(result).toEqual({ appended: 1, skipped: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does nothing when there is no text to append', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        expect(await appendTextBlocks('key', 'page', '   ')).toEqual({
            appended: 0,
            skipped: 0,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('fetchDatabaseSchema', () => {
    it('detects the title column whatever it is named', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({
                    id: 'db',
                    properties: {
                        Name: { type: 'title' },
                        URL: { type: 'url' },
                        Notes: { type: 'rich_text' },
                        Topics: { type: 'multi_select', multi_select: { options: [{ name: 'dev' }] } },
                    },
                })
            )
        );

        const schema = await fetchDatabaseSchema('key', 'db');
        expect(schema.titleProperty).toBe('Name');
        expect(schema.urlProperty).toBe('URL');
        expect(schema.descriptionProperty).toBe('Notes');
        expect(schema.tagsProperty).toBe('Topics');
        expect(schema.tagOptions).toEqual(['dev']);
    });

    it('does not claim optional columns that are absent', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({ id: 'db', properties: { Title: { type: 'title' } } })
            )
        );

        const schema = await fetchDatabaseSchema('key', 'db');
        expect(schema.urlProperty).toBeNull();
        expect(schema.highlightsProperty).toBeNull();
        expect(schema.tagsProperty).toBeNull();
    });

    it('maps a 404 to an actionable message', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({ code: 'object_not_found', message: 'Could not find database' }, 404)
            )
        );

        await expect(fetchDatabaseSchema('key', 'db')).rejects.toThrow(/Connections/);
    });

    it('classifies rate limiting as transient and retries', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ code: 'rate_limited' }, 429))
            .mockResolvedValueOnce(
                jsonResponse({ id: 'db', properties: { Title: { type: 'title' } } })
            );
        vi.stubGlobal('fetch', fetchMock);

        const schema = await fetchDatabaseSchema('key', 'db');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(schema.titleProperty).toBe('Title');
    });

    it('marks 401 as permanent so it is never queued for retry', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ code: 'unauthorized' }, 401))
        );

        await expect(fetchDatabaseSchema('key', 'db')).rejects.toSatisfy(
            (err: unknown) => err instanceof NotionApiError && !err.isTransient
        );
    });
});
