// Notion API helper for the extension service worker.

import type {
    DatabaseSchema,
    FetchSavedLinksResult,
    NotionPageData,
    SavedLinkItem,
} from './types';

export const NOTION_VERSION = '2022-06-28';

const API_BASE = 'https://api.notion.com/v1';

/** Notion caps a single rich text object at 2000 characters. */
const RICH_TEXT_CHUNK = 2000;
/** Notion caps a rich text array at 100 objects. */
const MAX_RICH_TEXT_ITEMS = 100;
/** Notion caps a single block-children request at 100 blocks. */
const MAX_BLOCKS_PER_REQUEST = 100;
/** Notion caps a request payload at 500KB; leave room for headers. */
const MAX_REQUEST_BYTES = 450_000;
/** Notion caps any URL property value at 2000 characters. */
const MAX_URL_LENGTH = 2000;
/** External images are only accepted with one of these extensions. */
const SUPPORTED_IMAGE_EXTENSION = /\.(bmp|gif|heic|jpe?g|png|svg|tiff?)(?:[?#]|$)/i;

const MAX_RETRIES = 3;
/** Notion allows ~3 requests/second; the block-by-block fallback must respect it. */
const BLOCK_RETRY_DELAY_MS = 350;
/** A batch whose blocks keep failing is invalid as a whole — stop probing it. */
const MAX_CONSECUTIVE_BLOCK_FAILURES = 5;

export class NotionApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'NotionApiError';
        this.status = status;
        this.code = code;
    }

    /** True when retrying the same request later has a chance of succeeding. */
    get isTransient(): boolean {
        return this.status === 0 || this.status === 429 || this.status >= 500;
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns a raw Notion error body into something a user can act on. */
const friendlyMessage = (status: number, code: string, notionMessage: string): string => {
    switch (status) {
        case 400:
            return code === 'validation_error'
                ? `Notion rejected the data: ${notionMessage}`
                : notionMessage || 'Notion rejected the request.';
        case 401:
            return 'Invalid Notion API key. Update it in the extension settings.';
        case 403:
            return 'The integration is not allowed to do this. Check its capabilities in Notion (e.g. "Insert comments").';
        case 404:
            return 'Database or page not found. Open it in Notion and connect your integration via ⋯ → Connections.';
        case 409:
            return 'Notion had a conflict saving this. Try again.';
        case 429:
            return 'Notion rate limit reached. Try again in a moment.';
        default:
            if (status >= 500) return 'Notion is temporarily unavailable. Try again later.';
            return notionMessage || `Notion API error ${status}.`;
    }
};

// Minimal shapes of the API responses this extension actually reads.
interface NotionRichTextItem {
    plain_text?: string;
}

interface NotionPropertyValue {
    type?: string;
    title?: NotionRichTextItem[];
    rich_text?: NotionRichTextItem[];
    url?: string | null;
}

interface NotionPageObject {
    id: string;
    object?: string;
    url?: string;
    created_time?: string;
    properties?: Record<string, NotionPropertyValue>;
}

interface NotionPropertySchema {
    type?: string;
    multi_select?: { options?: { name?: string }[] };
}

interface NotionDatabaseObject {
    id: string;
    url?: string;
    properties?: Record<string, NotionPropertySchema>;
}

interface NotionQueryResponse {
    results?: NotionPageObject[];
    next_cursor?: string | null;
    has_more?: boolean;
}

interface NotionFetchOptions {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    /**
     * Whether the request can be replayed safely. Reads set this so transient
     * server failures are retried in place; writes are left to the offline
     * queue so a half-applied request is never duplicated silently.
     */
    idempotent?: boolean;
}

const request = async <T>(
    apiKey: string,
    path: string,
    { method = 'GET', body, idempotent = false }: NotionFetchOptions = {}
): Promise<T> => {
    let lastError: NotionApiError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let response: Response;
        try {
            response = await fetch(`${API_BASE}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch {
            lastError = new NotionApiError(0, 'network_error', 'No connection to Notion.');
            if (idempotent && attempt < MAX_RETRIES) {
                await sleep(500 * 2 ** attempt);
                continue;
            }
            throw lastError;
        }

        if (response.ok) {
            return (response.status === 204 ? null : await response.json()) as T;
        }

        const rawBody = await response.text();
        let code = 'unknown_error';
        let notionMessage = '';
        try {
            const parsed = JSON.parse(rawBody);
            code = parsed.code || code;
            notionMessage = parsed.message || '';
        } catch {
            notionMessage = rawBody.slice(0, 200);
        }

        lastError = new NotionApiError(
            response.status,
            code,
            friendlyMessage(response.status, code, notionMessage)
        );

        // 429 means the request was rejected outright, so replaying it is always
        // safe. 5xx may have been applied server-side, so only reads retry.
        const canRetry =
            response.status === 429 || (idempotent && response.status >= 500);
        if (!canRetry || attempt === MAX_RETRIES) throw lastError;

        const retryAfter = Number(response.headers.get('Retry-After'));
        await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : 500 * 2 ** attempt
        );
    }

    throw lastError ?? new NotionApiError(0, 'unknown_error', 'Notion request failed.');
};

/** Splits text across rich text objects so the 2000 character cap is never hit. */
export const toRichText = (text: string) => {
    const chunks: string[] = [];
    for (
        let i = 0;
        i < text.length && chunks.length < MAX_RICH_TEXT_ITEMS;
        i += RICH_TEXT_CHUNK
    ) {
        chunks.push(text.slice(i, i + RICH_TEXT_CHUNK));
    }
    return chunks.map((content) => ({ text: { content } }));
};

// ---------------------------------------------------------------------------
// Schema discovery
// ---------------------------------------------------------------------------

const DEFAULT_SCHEMA: DatabaseSchema = {
    titleProperty: 'Title',
    urlProperty: 'Link',
    descriptionProperty: 'Description',
    tagsProperty: 'Tags',
    highlightsProperty: 'Highlights',
    sessionIdProperty: 'Session ID',
    tagOptions: [],
};

/**
 * Reads the live database schema so saving works regardless of how the user
 * named their columns (Notion's default title column is "Name", not "Title").
 */
export const fetchDatabaseSchema = async (
    apiKey: string,
    databaseId: string
): Promise<DatabaseSchema> => {
    const db = await request<NotionDatabaseObject>(apiKey, `/databases/${databaseId}`, {
        idempotent: true,
    });
    const properties: Record<string, NotionPropertySchema> = db.properties || {};
    const entries = Object.entries(properties);

    const byName = (name: string, type: string) =>
        entries.find(([key, prop]) => key === name && prop?.type === type)?.[0] ?? null;
    const firstOfType = (type: string, exclude: (string | null)[] = []) =>
        entries.find(([key, prop]) => prop?.type === type && !exclude.includes(key))?.[0] ??
        null;

    const titleProperty = firstOfType('title') ?? DEFAULT_SCHEMA.titleProperty;
    const urlProperty = byName('Link', 'url') ?? firstOfType('url');
    // Optional rich text columns are matched by name only: picking an arbitrary
    // text column for them would write user data into an unrelated field.
    const highlightsProperty = byName('Highlights', 'rich_text');
    const sessionIdProperty = byName('Session ID', 'rich_text');
    const descriptionProperty =
        byName('Description', 'rich_text') ??
        firstOfType('rich_text', [highlightsProperty, sessionIdProperty]);
    const tagsProperty = byName('Tags', 'multi_select') ?? firstOfType('multi_select');

    const tagOptions: string[] = tagsProperty
        ? (properties[tagsProperty]?.multi_select?.options || [])
              .map((option) => option.name)
              .filter((name): name is string => !!name)
        : [];

    return {
        titleProperty,
        urlProperty,
        descriptionProperty,
        tagsProperty,
        highlightsProperty,
        sessionIdProperty,
        tagOptions,
    };
};

/** Clamped identically on write and on lookup so url.equals still matches. */
export const clampUrl = (url: string) => url.slice(0, MAX_URL_LENGTH);

export const buildProperties = (schema: DatabaseSchema, data: NotionPageData) => {
    const props: Record<string, unknown> = {
        [schema.titleProperty]: { title: toRichText(data.title || data.url) },
    };

    if (schema.urlProperty) {
        props[schema.urlProperty] = { url: data.url ? clampUrl(data.url) : null };
    }

    if (schema.descriptionProperty && data.description) {
        props[schema.descriptionProperty] = { rich_text: toRichText(data.description) };
    }

    if (schema.tagsProperty && data.tags?.length) {
        // Notion rejects commas inside multi_select option names, so a tag like
        // "react, hooks" is split instead of failing the whole save.
        const unique = [
            ...new Set(
                data.tags
                    .flatMap((tag) => tag.split(','))
                    .map((tag) => tag.trim())
                    .filter(Boolean)
            ),
        ];
        props[schema.tagsProperty] = {
            multi_select: unique.map((name) => ({ name })),
        };
    }

    if (schema.sessionIdProperty && data.sessionId) {
        props[schema.sessionIdProperty] = { rich_text: toRichText(data.sessionId) };
    }

    if (schema.highlightsProperty && data.highlights) {
        props[schema.highlightsProperty] = { rich_text: toRichText(data.highlights) };
    }

    return props;
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const savePageToNotion = async (
    apiKey: string,
    databaseId: string,
    schema: DatabaseSchema,
    data: NotionPageData
) =>
    request<NotionPageObject>(apiKey, '/pages', {
        method: 'POST',
        body: {
            parent: { database_id: databaseId },
            properties: buildProperties(schema, data),
        },
    });

export const updatePageToNotion = async (
    apiKey: string,
    pageId: string,
    schema: DatabaseSchema,
    data: NotionPageData
) =>
    request<NotionPageObject>(apiKey, `/pages/${pageId}`, {
        method: 'PATCH',
        body: { properties: buildProperties(schema, data) },
    });

export interface PageLookupResult {
    exists: boolean;
    pageId: string | null;
    description: string;
    createdTime: string | null;
}

/**
 * Looks up an already saved page by URL. Throws on failure so the caller can
 * tell "not saved yet" apart from "we could not check" — treating the latter as
 * the former silently creates duplicate rows.
 */
export const checkIfPageSaved = async (
    apiKey: string,
    databaseId: string,
    schema: DatabaseSchema,
    url: string
): Promise<PageLookupResult> => {
    if (!schema.urlProperty) {
        return { exists: false, pageId: null, description: '', createdTime: null };
    }

    const data = await request<NotionQueryResponse>(apiKey, `/databases/${databaseId}/query`, {
        method: 'POST',
        idempotent: true,
        body: {
            page_size: 1,
            filter: { property: schema.urlProperty, url: { equals: clampUrl(url) } },
        },
    });

    const page = data.results?.[0];
    if (!page) return { exists: false, pageId: null, description: '', createdTime: null };

    const descriptionProp = schema.descriptionProperty
        ? page.properties?.[schema.descriptionProperty]
        : null;

    return {
        exists: true,
        pageId: page.id,
        description: descriptionProp?.rich_text?.[0]?.plain_text || '',
        createdTime: page.created_time || null,
    };
};

export const fetchSavedLinks = async (
    apiKey: string,
    databaseId: string,
    schema: DatabaseSchema,
    options: { startCursor?: string | null; pageSize?: number; search?: string } = {}
): Promise<FetchSavedLinksResult> => {
    const { startCursor, pageSize = 25, search } = options;

    const body: Record<string, unknown> = {
        page_size: pageSize,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    };
    if (startCursor) body.start_cursor = startCursor;

    if (search?.trim()) {
        const term = search.trim();
        const conditions: unknown[] = [
            { property: schema.titleProperty, title: { contains: term } },
        ];
        if (schema.urlProperty) {
            conditions.push({ property: schema.urlProperty, url: { contains: term } });
        }
        body.filter = { or: conditions };
    }

    const data = await request<NotionQueryResponse>(apiKey, `/databases/${databaseId}/query`, {
        method: 'POST',
        idempotent: true,
        body,
    });

    const items: SavedLinkItem[] = (data.results || []).map((page) => ({
        pageId: page.id,
        title: page.properties?.[schema.titleProperty]?.title?.[0]?.plain_text || '(untitled)',
        url: schema.urlProperty ? page.properties?.[schema.urlProperty]?.url || '' : '',
        description: schema.descriptionProperty
            ? page.properties?.[schema.descriptionProperty]?.rich_text?.[0]?.plain_text || ''
            : '',
        createdTime: page.created_time ?? '',
        notionUrl: page.url || `https://www.notion.so/${String(page.id).replace(/-/g, '')}`,
    }));

    return {
        items,
        nextCursor: data.next_cursor || null,
        hasMore: !!data.has_more,
    };
};

// ---------------------------------------------------------------------------
// Blocks and comments
// ---------------------------------------------------------------------------

export const addCommentToPage = async (apiKey: string, pageId: string, commentText: string) =>
    request<unknown>(apiKey, '/comments', {
        method: 'POST',
        body: { parent: { page_id: pageId }, rich_text: toRichText(commentText) },
    });

export interface AppendResult {
    appended: number;
    skipped: number;
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Notion rejects an external image whose URL has no recognised extension, and
 * one bad block fails the whole request — so they are dropped up front.
 */
const isAcceptableBlock = (block: unknown): boolean => {
    const candidate = block as { type?: string; image?: { external?: { url?: string } } };
    if (candidate?.type !== 'image') return true;
    const url = candidate.image?.external?.url;
    return !!url && SUPPORTED_IMAGE_EXTENSION.test(url);
};

/** Groups blocks into requests that respect both the 100 block and 500KB caps. */
const batchBlocks = (blocks: unknown[]): unknown[][] => {
    const batches: unknown[][] = [];
    let current: unknown[] = [];
    let currentBytes = 0;

    for (const block of blocks) {
        const size = byteLength(block);
        // A single oversized block can never be sent; skipping it keeps the rest.
        if (size > MAX_REQUEST_BYTES) continue;
        if (current.length === MAX_BLOCKS_PER_REQUEST || currentBytes + size > MAX_REQUEST_BYTES) {
            batches.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(block);
        currentBytes += size;
    }

    if (current.length) batches.push(current);
    return batches;
};

const appendChildren = (apiKey: string, pageId: string, children: unknown[]) =>
    request<unknown>(apiKey, `/blocks/${pageId}/children`, {
        method: 'PATCH',
        body: { children },
    });

/**
 * Appends blocks, honouring Notion's request limits. If a batch is rejected as
 * invalid, its blocks are retried individually so one unsupported block cannot
 * discard the other 99.
 */
const appendBlocks = async (
    apiKey: string,
    pageId: string,
    blocks: unknown[]
): Promise<AppendResult> => {
    const acceptable = blocks.filter(
        (block) => isAcceptableBlock(block) && byteLength(block) <= MAX_REQUEST_BYTES
    );
    let appended = 0;
    let skipped = blocks.length - acceptable.length;

    // Says how much already landed, so a caller never reports "nothing saved"
    // for a page that in fact received part of the content.
    const withProgress = (err: unknown) => {
        if (appended > 0 && err instanceof Error) {
            err.message = `${err.message} (${appended} block(s) had already been added)`;
        }
        return err;
    };

    for (const batch of batchBlocks(acceptable)) {
        try {
            await appendChildren(apiKey, pageId, batch);
            appended += batch.length;
        } catch (err) {
            if (!(err instanceof NotionApiError) || err.status !== 400 || batch.length === 1) {
                throw withProgress(err);
            }

            let consecutiveFailures = 0;
            for (const [index, block] of batch.entries()) {
                if (index > 0) await sleep(BLOCK_RETRY_DELAY_MS);
                try {
                    await appendChildren(apiKey, pageId, [block]);
                    appended++;
                    consecutiveFailures = 0;
                } catch (blockErr) {
                    if (!(blockErr instanceof NotionApiError) || blockErr.status !== 400) {
                        throw withProgress(blockErr);
                    }
                    skipped++;
                    if (++consecutiveFailures >= MAX_CONSECUTIVE_BLOCK_FAILURES) {
                        skipped += batch.length - index - 1;
                        break;
                    }
                }
            }
        }
    }

    return { appended, skipped };
};

export const appendImageBlocks = async (apiKey: string, pageId: string, imageUrls: string[]) =>
    appendBlocks(
        apiKey,
        pageId,
        imageUrls.map((url) => ({
            object: 'block',
            type: 'image',
            image: { type: 'external', external: { url } },
        }))
    );

export const appendTextBlocks = async (
    apiKey: string,
    pageId: string,
    text: string,
    blockType: 'paragraph' | 'quote' = 'paragraph'
) => {
    const blocks = text
        .split('\n')
        .filter((paragraph) => paragraph.trim() !== '')
        .map((paragraph) => ({
            object: 'block',
            type: blockType,
            [blockType]: { rich_text: toRichText(paragraph) },
        }));

    if (blocks.length === 0) return { appended: 0, skipped: 0 };
    return appendBlocks(apiKey, pageId, blocks);
};

export const appendRawBlocks = async (
    apiKey: string,
    pageId: string,
    blocks: unknown[]
): Promise<AppendResult> =>
    blocks.length ? appendBlocks(apiKey, pageId, blocks) : { appended: 0, skipped: 0 };

// ---------------------------------------------------------------------------
// Setup helpers (options page)
// ---------------------------------------------------------------------------

export interface NotionParentPage {
    id: string;
    title: string;
}

const plainTitleOf = (page: NotionPageObject): string => {
    for (const prop of Object.values(page.properties || {})) {
        if (prop?.type === 'title') {
            return prop.title?.[0]?.plain_text || '(untitled)';
        }
    }
    return '(untitled)';
};

/** Pages the integration has been granted access to — possible database parents. */
export const searchParentPages = async (apiKey: string): Promise<NotionParentPage[]> => {
    const data = await request<NotionQueryResponse>(apiKey, '/search', {
        method: 'POST',
        idempotent: true,
        body: {
            filter: { value: 'page', property: 'object' },
            page_size: 50,
        },
    });

    return (data.results || [])
        .filter((page) => page.object === 'page')
        .map((page) => ({ id: page.id, title: plainTitleOf(page) }));
};

/** Creates a database with the exact schema this extension expects. */
export const createLinksDatabase = async (
    apiKey: string,
    parentPageId: string,
    title = 'Saved Links'
): Promise<{ id: string; url: string }> => {
    const database = await request<NotionDatabaseObject>(apiKey, '/databases', {
        method: 'POST',
        body: {
            parent: { type: 'page_id', page_id: parentPageId },
            title: [{ type: 'text', text: { content: title } }],
            properties: {
                Title: { title: {} },
                Link: { url: {} },
                Description: { rich_text: {} },
                Tags: { multi_select: {} },
                Highlights: { rich_text: {} },
                'Session ID': { rich_text: {} },
            },
        },
    });

    return { id: database.id, url: database.url ?? '' };
};
