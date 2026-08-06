import {
    NotionApiError,
    type AppendResult,
    addCommentToPage,
    appendImageBlocks,
    appendRawBlocks,
    appendTextBlocks,
    checkIfPageSaved,
    createLinksDatabase,
    fetchDatabaseSchema,
    fetchSavedLinks,
    savePageToNotion,
    searchParentPages,
    updatePageToNotion,
} from './notionClient';
import { AiApiError, askAi } from './openAiClient';
import { collectPageMetadata } from './pageMetadata';
import type {
    BackgroundRequest,
    MessageType,
    RequestOf,
    ResponsePayload,
} from './messages';
import type {
    DatabaseSchema,
    NotionPageData,
    PageMetadata,
    QueueItem,
    SavedLinkItem,
} from './types';

/** How long the first page of saved links stays fresh. */
const SAVED_LINKS_CACHE_TTL_MS = 5 * 60 * 1000;
/** Database schemas change rarely; re-reading them on every save is wasteful. */
const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;
const QUEUE_ALARM = 'processOfflineQueue';
const MAX_QUEUE_ATTEMPTS = 5;
/**
 * Notion allows ~3 requests/second and each queued item costs a lookup plus a
 * write, so keep a wide margin when draining the queue.
 */
const QUEUE_THROTTLE_MS = 700;
const MAX_RECORDED_FAILURES = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

const isTransient = (err: unknown): boolean =>
    (err instanceof NotionApiError && err.isTransient) ||
    (err instanceof AiApiError && err.status === 0);

/** Signals that a save did not go through but was parked for a later retry. */
class QueuedError extends Error {
    readonly queued = true;
}

/**
 * Raised when the database row was written but attaching the clipped article
 * failed. It carries the new page id so the caller never retries the save and
 * ends up with a duplicate row.
 */
class ClipError extends Error {
    readonly pageId: string;

    constructor(pageId: string, cause: unknown) {
        super(errorMessage(cause));
        this.name = 'ClipError';
        this.pageId = pageId;
    }
}

/**
 * Notion's wordings for "this column does not exist". Matching the phrasing
 * rather than the word "property" keeps ordinary value errors from triggering a
 * pointless schema refresh and replay.
 */
const SCHEMA_MISMATCH_MESSAGE =
    /(is not a property that exists|could not find property|property with name or id)/i;

/** A stale cached column mapping shows up as Notion rejecting a property name. */
const isSchemaMismatch = (err: unknown): boolean =>
    err instanceof NotionApiError &&
    err.status === 400 &&
    err.code === 'validation_error' &&
    SCHEMA_MISMATCH_MESSAGE.test(err.message);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Settings {
    notionApiKey: string;
    notionDatabaseId: string;
    openAiApiKey: string;
    aiModel: string;
}

const getSettings = async (): Promise<Settings> => {
    const store = await chrome.storage.local.get([
        'notionApiKey',
        'notionDatabaseId',
        'openAiApiKey',
        'aiModel',
    ]);
    return {
        notionApiKey: String(store.notionApiKey || ''),
        notionDatabaseId: String(store.notionDatabaseId || ''),
        openAiApiKey: String(store.openAiApiKey || ''),
        aiModel: String(store.aiModel || 'openai/gpt-4o-mini'),
    };
};

const requireNotionSettings = async (): Promise<Settings> => {
    const settings = await getSettings();
    if (!settings.notionApiKey || !settings.notionDatabaseId) {
        throw new Error('Missing Notion API key or Database ID. Open the extension options.');
    }
    return settings;
};

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const schemaCacheKey = (databaseId: string) => `dbSchema_${databaseId}`;
const savedLinksCacheKey = (databaseId: string) => `savedLinksCache_${databaseId}`;

const getSchema = async (
    apiKey: string,
    databaseId: string,
    forceRefresh = false
): Promise<DatabaseSchema> => {
    const key = schemaCacheKey(databaseId);
    if (!forceRefresh) {
        const cached = (await chrome.storage.local.get(key))[key] as
            | { schema: DatabaseSchema; timestamp: number }
            | undefined;
        if (cached?.schema && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL_MS) {
            return cached.schema;
        }
    }

    const schema = await fetchDatabaseSchema(apiKey, databaseId);
    await chrome.storage.local.set({ [key]: { schema, timestamp: Date.now() } });
    return schema;
};

const invalidateSavedLinks = (databaseId: string) =>
    chrome.storage.local.remove(savedLinksCacheKey(databaseId));

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

// Chrome runs a single service worker per extension, so serialising every
// read-modify-write through one promise chain is enough to stop the alarm
// handler and a save from clobbering each other's queue writes.
let queueLock: Promise<unknown> = Promise.resolve();

const withQueueLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queueLock.then(fn, fn);
    queueLock = run.then(
        () => undefined,
        () => undefined
    );
    return run;
};

const readQueue = async (): Promise<QueueItem[]> => {
    const { offlineQueue } = await chrome.storage.local.get('offlineQueue');
    return Array.isArray(offlineQueue) ? (offlineQueue as QueueItem[]) : [];
};

const enqueueSave = (
    data: NotionPageData,
    { pageId, clipBlocks, forceNew }: SaveOptions & { forceNew?: boolean } = {}
) =>
    withQueueLock(async () => {
        const queue = await readQueue();
        queue.push({
            id: crypto.randomUUID(),
            data,
            pageId,
            clipBlocks,
            forceNew,
            attempts: 0,
            createdAt: Date.now(),
        });
        await chrome.storage.local.set({ offlineQueue: queue });
        return queue.length;
    });

const removeQueueItem = (id: string) =>
    withQueueLock(async () => {
        const queue = await readQueue();
        await chrome.storage.local.set({
            offlineQueue: queue.filter((item) => item.id !== id),
        });
    });

const markQueueAttempt = (id: string, error: string) =>
    withQueueLock(async () => {
        const queue = await readQueue();
        await chrome.storage.local.set({
            offlineQueue: queue.map((item) =>
                item.id === id
                    ? { ...item, attempts: item.attempts + 1, lastError: error }
                    : item
            ),
        });
    });

/** Keeps a trace of saves that were dropped so they never vanish silently. */
const recordFailure = async (item: QueueItem, error: string) => {
    const { queueFailures } = await chrome.storage.local.get('queueFailures');
    const failures = Array.isArray(queueFailures) ? queueFailures : [];
    failures.unshift({
        title: item.data.title,
        url: item.data.url,
        error,
        failedAt: Date.now(),
    });
    await chrome.storage.local.set({
        queueFailures: failures.slice(0, MAX_RECORDED_FAILURES),
    });
};

const refreshBadge = async () => {
    const queue = await readQueue();
    await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : '' });
};

const flashBadge = async (text: string, color: string) => {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => void refreshBadge(), 2500);
};

let processingQueue = false;

const processQueue = async () => {
    if (processingQueue) return;
    processingQueue = true;
    try {
        const { notionApiKey, notionDatabaseId } = await getSettings();
        if (!notionApiKey || !notionDatabaseId) return;

        const snapshot = await readQueue();
        if (snapshot.length === 0) return;

        let savedCount = 0;

        for (const [index, item] of snapshot.entries()) {
            if (index > 0) await sleep(QUEUE_THROTTLE_MS);
            try {
                // withSchemaRetry here too: a column renamed since the item was
                // queued would otherwise discard every entry as a permanent error.
                await withSchemaRetry(notionApiKey, notionDatabaseId, (schema) =>
                    performSave(notionApiKey, notionDatabaseId, schema, item.data, {
                        pageId: item.pageId,
                        clipBlocks: item.clipBlocks,
                        // Look first: the row may already exist because the original
                        // save reached Notion, or because a worker shutdown
                        // interrupted a previous drain between saving and removal.
                        // Unless the user explicitly asked for a separate row.
                        dedupe: !item.forceNew,
                    })
                );
                await removeQueueItem(item.id);
                savedCount++;
            } catch (err) {
                if (err instanceof ClipError) {
                    // The row landed; retrying the whole save would duplicate it,
                    // so only the lost article body is reported.
                    await recordFailure(item, `Saved, but the article clip failed: ${err.message}`);
                    await removeQueueItem(item.id);
                    savedCount++;
                    continue;
                }
                const message = errorMessage(err);
                const attempts = item.attempts + 1;
                if (!isTransient(err) || attempts >= MAX_QUEUE_ATTEMPTS) {
                    await recordFailure(item, message);
                    await removeQueueItem(item.id);
                } else {
                    await markQueueAttempt(item.id, message);
                }
            }
        }

        if (savedCount > 0) await invalidateSavedLinks(notionDatabaseId);
    } catch (err) {
        // Reading settings or the schema can fail; the queue is retried by the
        // next alarm, so this must not surface as an unhandled rejection.
        console.error('[Save to Notion] Queue processing failed:', errorMessage(err));
    } finally {
        processingQueue = false;
        await refreshBadge();
    }
};

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

interface SaveOptions {
    pageId?: string;
    clipBlocks?: unknown[];
    /** Look for an existing row before creating a new one. */
    dedupe?: boolean;
    /** The user asked for a separate row even though the URL is already saved. */
    forceNew?: boolean;
}

const performSave = async (
    apiKey: string,
    databaseId: string,
    schema: DatabaseSchema,
    data: NotionPageData,
    { pageId, clipBlocks, dedupe }: SaveOptions = {}
): Promise<{ pageId: string | null; clip: AppendResult }> => {
    let targetPageId = pageId ?? null;

    if (!targetPageId && dedupe) {
        const existing = await checkIfPageSaved(apiKey, databaseId, schema, data.url);
        if (existing.exists && existing.pageId) targetPageId = existing.pageId;
    }

    if (targetPageId) {
        await updatePageToNotion(apiKey, targetPageId, schema, data);
    } else {
        const page = await savePageToNotion(apiKey, databaseId, schema, data);
        targetPageId = page?.id ?? null;
    }

    let clip: AppendResult = { appended: 0, skipped: 0 };
    if (clipBlocks?.length && targetPageId) {
        try {
            clip = await appendRawBlocks(apiKey, targetPageId, clipBlocks);
        } catch (err) {
            throw new ClipError(targetPageId, err);
        }
    }

    return { pageId: targetPageId, clip };
};

/**
 * Runs an operation against the cached schema and retries once with a fresh one
 * if Notion rejects a column name. A validation_error means nothing was written,
 * so the replay cannot duplicate anything.
 */
const withSchemaRetry = async <T>(
    apiKey: string,
    databaseId: string,
    run: (schema: DatabaseSchema) => Promise<T>
): Promise<T> => {
    const schema = await getSchema(apiKey, databaseId);
    try {
        return await run(schema);
    } catch (err) {
        if (!isSchemaMismatch(err)) throw err;
        return run(await getSchema(apiKey, databaseId, true));
    }
};

/** Saves and, when the failure is transient, parks the payload for later. */
const saveOrQueue = async (
    data: NotionPageData,
    options: SaveOptions = {}
): Promise<{
    pageId: string | null;
    clipped: number;
    clipSkipped: number;
    clipError?: string;
}> => {
    const { notionApiKey, notionDatabaseId } = await requireNotionSettings();

    try {
        // Reading the schema lives inside the try so that losing connectivity
        // while the cached schema is stale still queues the save instead of
        // dropping it.
        const result = await withSchemaRetry(notionApiKey, notionDatabaseId, (schema) =>
            performSave(notionApiKey, notionDatabaseId, schema, data, options)
        );
        await invalidateSavedLinks(notionDatabaseId);
        return {
            pageId: result.pageId,
            clipped: result.clip.appended,
            clipSkipped: result.clip.skipped,
        };
    } catch (err) {
        if (err instanceof ClipError) {
            // The row exists. Queueing another save would duplicate it, so the
            // clip failure is reported instead.
            await invalidateSavedLinks(notionDatabaseId);
            return {
                pageId: err.pageId,
                clipped: 0,
                clipSkipped: 0,
                clipError: err.message,
            };
        }
        if (!isTransient(err)) throw err;

        let pending: number;
        try {
            pending = await enqueueSave(data, options);
        } catch (queueErr) {
            // Storage is full (clipped articles are bulky): report the original
            // failure rather than pretending the save is safely parked.
            console.error('[Save to Notion] Could not queue the save:', errorMessage(queueErr));
            throw err;
        }

        await refreshBadge();
        throw new QueuedError(
            `${errorMessage(err)} Saved to the offline queue (${pending} pending).`
        );
    }
};

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

type Handlers = {
    [K in MessageType]: (request: RequestOf<K>) => Promise<ResponsePayload<K>>;
};

const handlers: Handlers = {
    PING: async () => ({ status: 'OK' }),

    SAVE_PAGE: async ({ data, pageId, clipBlocks, forceNew }) =>
        saveOrQueue(data, {
            pageId,
            clipBlocks,
            forceNew,
            // Without a target row, look one up: the popup's own check may have
            // failed or gone stale, and a duplicate row cannot be undone.
            dedupe: !forceNew && !pageId,
        }),

    CHECK_PAGE: async ({ url }) => {
        const { notionApiKey, notionDatabaseId } = await requireNotionSettings();
        return withSchemaRetry(notionApiKey, notionDatabaseId, (schema) =>
            checkIfPageSaved(notionApiKey, notionDatabaseId, schema, url)
        );
    },

    ASK_AI: async ({ messages }) => {
        const { openAiApiKey, aiModel } = await getSettings();
        if (!openAiApiKey) {
            throw new Error('Missing AI API key. Configure it in the extension options.');
        }
        return { reply: await askAi(openAiApiKey, aiModel, messages) };
    },

    ADD_COMMENT_TO_PAGE: async ({ pageId, text }) => {
        const { notionApiKey } = await requireNotionSettings();
        await addCommentToPage(notionApiKey, pageId, text);
        return {};
    },

    APPEND_IMAGE_BLOCKS: async ({ pageId, urls }) => {
        const { notionApiKey } = await requireNotionSettings();
        return appendImageBlocks(notionApiKey, pageId, urls);
    },

    APPEND_TEXT_BLOCKS: async ({ pageId, text, blockType }) => {
        const { notionApiKey } = await requireNotionSettings();
        return appendTextBlocks(notionApiKey, pageId, text, blockType);
    },

    APPEND_RAW_BLOCKS: async ({ pageId, blocks }) => {
        const { notionApiKey } = await requireNotionSettings();
        return appendRawBlocks(notionApiKey, pageId, blocks);
    },

    FETCH_LINKS: async ({ startCursor, search, forceRefresh }) => {
        const { notionApiKey, notionDatabaseId } = await requireNotionSettings();
        const term = (search || '').trim();
        const isCacheable = !startCursor && term === '';
        const cacheKey = savedLinksCacheKey(notionDatabaseId);

        if (isCacheable && !forceRefresh) {
            const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as
                | {
                      items: SavedLinkItem[];
                      nextCursor: string | null;
                      hasMore: boolean;
                      timestamp: number;
                  }
                | undefined;
            if (cached && Date.now() - cached.timestamp < SAVED_LINKS_CACHE_TTL_MS) {
                return {
                    items: cached.items,
                    nextCursor: cached.nextCursor,
                    hasMore: cached.hasMore,
                    fromCache: true,
                };
            }
        }

        const result = await withSchemaRetry(notionApiKey, notionDatabaseId, (schema) =>
            fetchSavedLinks(notionApiKey, notionDatabaseId, schema, {
                startCursor,
                search: term,
                pageSize: 25,
            })
        );

        if (isCacheable) {
            await chrome.storage.local.set({
                [cacheKey]: { ...result, timestamp: Date.now() },
            });
        }

        return { ...result, fromCache: false };
    },

    FETCH_SCHEMA: async ({ forceRefresh }) => {
        const { notionApiKey, notionDatabaseId } = await requireNotionSettings();
        return { schema: await getSchema(notionApiKey, notionDatabaseId, forceRefresh) };
    },

    SEARCH_PARENT_PAGES: async ({ apiKey }) => ({
        pages: await searchParentPages(apiKey),
    }),

    CREATE_DATABASE: async ({ apiKey, parentPageId, title }) => {
        const database = await createLinksDatabase(apiKey, parentPageId, title);
        return { databaseId: database.id, url: database.url };
    },

    QUEUE_STATUS: async () => ({ pending: (await readQueue()).length }),
};

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
    const handler = handlers[message?.type] as
        | ((request: BackgroundRequest) => Promise<object>)
        | undefined;
    // Returning true for unknown types would leave the message channel hanging.
    if (!handler) return false;

    handler(message)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((err) => {
            console.error(`[Save to Notion] ${message.type} failed:`, errorMessage(err));
            sendResponse({
                success: false,
                error: errorMessage(err),
                ...(err instanceof QueuedError ? { queued: true } : {}),
            });
        });

    return true;
});

// ---------------------------------------------------------------------------
// Quick save (context menu and keyboard shortcut)
// ---------------------------------------------------------------------------

const readPageMetadata = async (tabId: number): Promise<PageMetadata | null> => {
    try {
        const [injection] = await chrome.scripting.executeScript({
            target: { tabId },
            func: collectPageMetadata,
        });
        return (injection?.result as PageMetadata) ?? null;
    } catch {
        return null;
    }
};

const quickSave = async (
    tab: chrome.tabs.Tab | undefined,
    overrides: Partial<NotionPageData> = {}
) => {
    try {
        const metadata = tab?.id ? await readPageMetadata(tab.id) : null;
        const url = overrides.url || metadata?.url || tab?.url || '';
        if (!url) throw new Error('No URL to save.');

        const data: NotionPageData = {
            url,
            title: overrides.title || metadata?.title || tab?.title || url,
            description: overrides.description ?? metadata?.description ?? '',
            tags: overrides.tags ?? (metadata?.type ? [metadata.type] : []),
            highlights: overrides.highlights,
        };

        // dedupe lets performSave update an existing row instead of duplicating it.
        await saveOrQueue(data, { dedupe: true });
        await flashBadge('✓', '#16a34a');
    } catch (err) {
        if (err instanceof QueuedError) {
            await flashBadge('⋯', '#d97706');
            return;
        }
        console.error('[Save to Notion] Quick save failed:', errorMessage(err));
        await flashBadge('!', '#dc2626');
    }
};

const CONTEXT_MENUS: chrome.contextMenus.CreateProperties[] = [
    { id: 'save-page', title: 'Save this page to Notion', contexts: ['page'] },
    { id: 'save-link', title: 'Save link to Notion', contexts: ['link'] },
    { id: 'save-selection', title: 'Save selection to Notion', contexts: ['selection'] },
];

const createContextMenus = () => {
    chrome.contextMenus.removeAll(() => {
        for (const menu of CONTEXT_MENUS) chrome.contextMenus.create(menu);
    });
};

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'save-link' && info.linkUrl) {
        void quickSave(tab, {
            url: info.linkUrl,
            title: info.selectionText || info.linkUrl,
            description: '',
            tags: [],
        });
        return;
    }

    if (info.menuItemId === 'save-selection') {
        void quickSave(tab, { highlights: info.selectionText || undefined });
        return;
    }

    if (info.menuItemId === 'save-page') void quickSave(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'quick-save') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await quickSave(tab);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const ensureQueueAlarm = async () => {
    // Re-creating the alarm on every worker wake-up would reset its period and
    // it might never fire while the extension is in active use.
    const existing = await chrome.alarms.get(QUEUE_ALARM);
    if (!existing) await chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 2 });
};

chrome.runtime.onInstalled.addListener(() => {
    createContextMenus();
    void ensureQueueAlarm();
    void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
    void ensureQueueAlarm();
    void processQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === QUEUE_ALARM) void processQueue();
});
