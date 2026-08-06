// Typed request/response protocol between the popup, options page and the
// service worker. Keeping it in one place means a renamed field breaks the
// build instead of silently returning undefined at runtime.

import type { ChatMessage } from './openAiClient';
import type { NotionParentPage } from './notionClient';
import type { DatabaseSchema, NotionPageData, SavedLinkItem } from './types';

type Payloads = {
    PING: { req: Record<string, never>; res: { status: string } };
    SAVE_PAGE: {
        req: {
            data: NotionPageData;
            pageId?: string;
            clipBlocks?: unknown[];
            /** Create a separate row even if this URL is already in the database. */
            forceNew?: boolean;
        };
        res: {
            pageId: string | null;
            clipped: number;
            clipSkipped: number;
            /** Set when the row was saved but the clipped body could not be attached. */
            clipError?: string;
        };
    };
    CHECK_PAGE: {
        req: { url: string };
        res: { exists: boolean; pageId: string | null; description: string; createdTime: string | null };
    };
    ASK_AI: { req: { messages: ChatMessage[] }; res: { reply: string } };
    ADD_COMMENT_TO_PAGE: { req: { pageId: string; text: string }; res: Record<string, never> };
    APPEND_IMAGE_BLOCKS: {
        req: { pageId: string; urls: string[] };
        res: { appended: number; skipped: number };
    };
    APPEND_TEXT_BLOCKS: {
        req: { pageId: string; text: string; blockType?: 'paragraph' | 'quote' };
        res: { appended: number; skipped: number };
    };
    APPEND_RAW_BLOCKS: {
        req: { pageId: string; blocks: unknown[] };
        res: { appended: number; skipped: number };
    };
    FETCH_LINKS: {
        req: { startCursor?: string | null; search?: string; forceRefresh?: boolean };
        res: {
            items: SavedLinkItem[];
            nextCursor: string | null;
            hasMore: boolean;
            fromCache: boolean;
        };
    };
    FETCH_SCHEMA: { req: { forceRefresh?: boolean }; res: { schema: DatabaseSchema } };
    SEARCH_PARENT_PAGES: { req: { apiKey: string }; res: { pages: NotionParentPage[] } };
    CREATE_DATABASE: {
        req: { apiKey: string; parentPageId: string; title?: string };
        res: { databaseId: string; url: string };
    };
    QUEUE_STATUS: { req: Record<string, never>; res: { pending: number } };
};

export type MessageType = keyof Payloads;

export type BackgroundRequest = {
    [K in MessageType]: { type: K } & Payloads[K]['req'];
}[MessageType];

export type RequestOf<T extends MessageType> = { type: T } & Payloads[T]['req'];

export type ResponsePayload<T extends MessageType> = Payloads[T]['res'];

export type ErrorResponse = { success: false; error: string; queued?: boolean };

export type BackgroundResponse<T extends MessageType> =
    | ({ success: true } & Payloads[T]['res'])
    | ErrorResponse;

export const isExtensionContext = (): boolean =>
    typeof chrome !== 'undefined' && !!chrome.runtime?.id;

/**
 * Promise wrapper around chrome.runtime.sendMessage that never throws: a dead
 * service worker becomes a normal error response instead of an unhandled
 * rejection that leaves the UI spinning forever.
 */
export const sendMessage = async <T extends MessageType>(
    message: { type: T } & Payloads[T]['req']
): Promise<BackgroundResponse<T>> => {
    if (!isExtensionContext()) {
        return { success: false, error: 'Not running inside the extension.' };
    }

    try {
        const response = await chrome.runtime.sendMessage(message);
        if (!response) {
            return { success: false, error: 'No response from the extension service worker.' };
        }
        return response as BackgroundResponse<T>;
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Extension messaging failed.',
        };
    }
};
