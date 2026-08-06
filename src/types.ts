// Shared types used across the popup, options page and service worker.

/** Metadata scraped from the active tab. */
export interface PageMetadata {
    title: string;
    url: string;
    description: string;
    image: string;
    type: string;
    selectedText: string;
    images: string[];
}

/** Payload written to a Notion database row. */
export interface NotionPageData {
    url: string;
    title: string;
    description: string;
    tags: string[];
    sessionId?: string;
    highlights?: string;
}

export interface SavedLinkItem {
    pageId: string;
    title: string;
    url: string;
    description: string;
    createdTime: string;
    notionUrl: string;
}

export interface FetchSavedLinksResult {
    items: SavedLinkItem[];
    nextCursor: string | null;
    hasMore: boolean;
}

/**
 * Names of the database columns this extension writes to, resolved from the
 * live database schema instead of being hardcoded. `null` means the database
 * has no suitable column and the value is skipped on save.
 */
export interface DatabaseSchema {
    titleProperty: string;
    urlProperty: string | null;
    descriptionProperty: string | null;
    tagsProperty: string | null;
    highlightsProperty: string | null;
    sessionIdProperty: string | null;
    /** Existing options of the multi-select column used for tags. */
    tagOptions: string[];
}

export interface QueueItem {
    id: string;
    data: NotionPageData;
    pageId?: string;
    clipBlocks?: unknown[];
    /** The user asked for a separate row, so the retry must not merge into an existing one. */
    forceNew?: boolean;
    attempts: number;
    lastError?: string;
    createdAt: number;
}
