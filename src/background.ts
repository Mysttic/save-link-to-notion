import { savePageToNotion, updatePageToNotion, checkIfPageSaved, addCommentToPage, appendImageBlocks, appendTextBlocks, fetchSavedLinks } from './notionClient';
import { askOpenAI } from './openAiClient';

// How long (ms) the first-page cache of saved links is considered fresh.
const SAVED_LINKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

chrome.runtime.onInstalled.addListener(() => {
    console.log('Save Link to Notion: Extension Installed');
});

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'PING') {
        sendResponse({ status: 'OK' });
    } else if (message.type === 'SAVE_PAGE') {
        // Expected message payload: { type: 'SAVE_PAGE', data: NotionPageData }
        chrome.storage.local.get(['notionApiKey', 'notionDatabaseId'], async (store) => {
            const { notionApiKey, notionDatabaseId } = store;
            if (!notionApiKey || !notionDatabaseId) {
                sendResponse({ success: false, error: 'Missing API key or Database ID in settings' });
                return;
            }

            try {
                if (!navigator.onLine) {
                    throw new Error('Offline - no internet connection');
                }
                const result = message.pageId
                    ? await updatePageToNotion(String(notionApiKey), message.pageId, message.data)
                    : await savePageToNotion(String(notionApiKey), String(notionDatabaseId), message.data);
                console.log('[Save to Notion] Saved/Updated successfully', result);
                // Invalidate the saved-links cache so the "Saved" tab reflects new/updated entries
                chrome.storage.local.remove('savedLinksCache');
                sendResponse({ success: true, result });
            } catch (err: any) {
                console.error('[Save to Notion] ERROR saving to Notion:', err?.message || err);
                console.error('[Save to Notion] Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err) as any));
                console.error('[Save to Notion] Debug info — apiKey first6:', String(notionApiKey).substring(0, 6), '| dbId first6:', String(notionDatabaseId).substring(0, 6));
                chrome.storage.local.get(['offlineQueue'], (qStore) => {
                    const queue: any[] = Array.isArray(qStore.offlineQueue) ? qStore.offlineQueue : [];
                    queue.push({
                        id: Date.now().toString(),
                        data: message.data,
                        pageId: message.pageId,
                        timestamp: Date.now()
                    });
                    chrome.storage.local.set({ offlineQueue: queue });
                    console.error('[Save to Notion] Added to offline queue. Queue size:', queue.length);
                });
                sendResponse({ success: false, queued: true, error: `Save failed: ${err?.message || 'Unknown error'}. Added to offline queue.` });
            }
        });

        return true; // Keep the message channel open for async responses
    } else if (message.type === 'ASK_AI') {
        chrome.storage.local.get(['openAiApiKey', 'aiModel'], async (store) => {
            const apiKey = store.openAiApiKey;
            const model = store.aiModel || 'gpt-4o-mini';

            if (!apiKey) {
                sendResponse({ success: false, error: 'Missing AI API key. Configure it in Options.' });
                return;
            }

            try {
                const aiResponse = await askOpenAI(String(apiKey), String(model), message.messages);
                sendResponse({ success: true, reply: aiResponse });
            } catch (err: any) {
                console.error('Error calling AI API', err);
                sendResponse({ success: false, error: err.message });
            }
        });

        return true; // async response
    } else if (message.type === 'CHECK_PAGE') {
        chrome.storage.local.get(['notionApiKey', 'notionDatabaseId'], async (store) => {
            if (!store.notionApiKey || !store.notionDatabaseId) {
                sendResponse({ success: false, error: 'Not configured' });
                return;
            }

            try {
                const result = await checkIfPageSaved(String(store.notionApiKey), String(store.notionDatabaseId), message.url);
                sendResponse({ success: true, ...result });
            } catch (err: any) {
                console.error('Error checking page', err);
                sendResponse({ success: false, error: err.message });
            }
        });

        return true;
    } else if (message.type === 'ADD_COMMENT_TO_PAGE') {
        chrome.storage.local.get(['notionApiKey'], async (store) => {
            if (!store.notionApiKey) {
                sendResponse({ success: false, error: 'Not configured' });
                return;
            }
            try {
                const result = await addCommentToPage(String(store.notionApiKey), message.pageId, message.text);
                sendResponse({ success: true, result });
            } catch (err: any) {
                console.error('Error adding comment', err);
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    } else if (message.type === 'APPEND_BLOCKS') {
        chrome.storage.local.get(['notionApiKey'], async (store) => {
            if (!store.notionApiKey) {
                sendResponse({ success: false, error: 'Not configured' });
                return;
            }
            try {
                const result = await appendImageBlocks(String(store.notionApiKey), message.pageId, message.urls);
                sendResponse({ success: true, result });
            } catch (err: any) {
                console.error('Error appending blocks', err);
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    } else if (message.type === 'FETCH_LINKS') {
        // Expected payload: { type: 'FETCH_LINKS', startCursor?: string|null, search?: string, forceRefresh?: boolean }
        const startCursor: string | null = message.startCursor || null;
        const search: string = (message.search || '').trim();
        const forceRefresh: boolean = !!message.forceRefresh;
        const isFirstPage = !startCursor;
        const isUnfiltered = search === '';

        chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'savedLinksCache'], async (store) => {
            if (!store.notionApiKey || !store.notionDatabaseId) {
                sendResponse({ success: false, error: 'Missing API key or Database ID in settings' });
                return;
            }

            // Serve first unfiltered page from cache when fresh
            if (isFirstPage && isUnfiltered && !forceRefresh) {
                const cache = store.savedLinksCache as { timestamp?: number; items?: any[]; nextCursor?: string | null; hasMore?: boolean } | undefined;
                if (cache && cache.timestamp && Date.now() - cache.timestamp < SAVED_LINKS_CACHE_TTL_MS) {
                    sendResponse({ success: true, items: cache.items, nextCursor: cache.nextCursor, hasMore: cache.hasMore, fromCache: true });
                    return;
                }
            }

            try {
                const result = await fetchSavedLinks(
                    String(store.notionApiKey),
                    String(store.notionDatabaseId),
                    { startCursor, search, pageSize: 25 }
                );

                // Cache only the first unfiltered page
                if (isFirstPage && isUnfiltered) {
                    chrome.storage.local.set({
                        savedLinksCache: {
                            items: result.items,
                            nextCursor: result.nextCursor,
                            hasMore: result.hasMore,
                            timestamp: Date.now()
                        }
                    });
                }

                sendResponse({ success: true, ...result, fromCache: false });
            } catch (err: any) {
                console.error('Error fetching saved links', err);
                sendResponse({ success: false, error: err?.message || String(err) });
            }
        });
        return true;
    } else if (message.type === 'APPEND_TEXT_BLOCKS') {
        chrome.storage.local.get(['notionApiKey'], async (store) => {
            if (!store.notionApiKey) {
                sendResponse({ success: false, error: 'Not configured' });
                return;
            }
            try {
                const result = await appendTextBlocks(String(store.notionApiKey), message.pageId, message.text);
                sendResponse({ success: true, result });
            } catch (err: any) {
                console.error('Error appending text blocks', err);
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    }
    return true;
});

// Regular offline queue processor
chrome.alarms.create('processOfflineQueue', { periodInMinutes: 2 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'processOfflineQueue' && navigator.onLine) {
        chrome.storage.local.get(['offlineQueue', 'notionApiKey', 'notionDatabaseId'], async (store) => {
            const queue: any[] = Array.isArray(store.offlineQueue) ? store.offlineQueue : [];
            if (queue.length === 0 || !store.notionApiKey || !store.notionDatabaseId) return;

            const remainingQueue = [];
            for (const item of queue) {
                try {
                    if (item.pageId) {
                        await updatePageToNotion(String(store.notionApiKey), item.pageId, item.data);
                    } else {
                        await savePageToNotion(String(store.notionApiKey), String(store.notionDatabaseId), item.data);
                    }
                    console.log('Successfully processed offline item', item.id);
                } catch (e) {
                    console.warn('Still failing to process item', item.id, e);
                    remainingQueue.push(item);
                }
            }
            chrome.storage.local.set({ offlineQueue: remainingQueue });
        });
    }
});
