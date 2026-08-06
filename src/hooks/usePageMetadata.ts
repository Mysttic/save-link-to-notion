import { useCallback, useEffect, useState } from 'react';
import { isExtensionContext, sendMessage } from '../messages';
import { collectPageMetadata } from '../pageMetadata';
import { formatDate } from '../utils';
import type { PageMetadata } from '../types';

export type PageLookup =
    | { status: 'idle' | 'checking' | 'absent' }
    | { status: 'found'; pageId: string; summary: string }
    | { status: 'error'; message: string };

const EMPTY_METADATA: PageMetadata = {
    title: '',
    url: '',
    description: '',
    image: '',
    type: '',
    selectedText: '',
    images: [],
};

const describeExisting = (createdTime: string | null, description: string): string => {
    const when = createdTime ? formatDate(createdTime) : '';
    const prefix = when ? `Saved on ${when}` : 'Already saved';
    return description ? `${prefix} with note: "${description}"` : `${prefix}.`;
};

/**
 * Reads metadata from the active tab and checks whether the URL is already in
 * the database. A failed check is reported as its own state so the UI never
 * presents "not saved yet" when it simply could not ask Notion.
 */
export const usePageMetadata = () => {
    // Outside the extension (vite dev server) there is no tab to inspect, so the
    // mock page is the initial state rather than an effect-driven update.
    const [pageData, setPageData] = useState<PageMetadata | null>(() =>
        isExtensionContext()
            ? null
            : { ...EMPTY_METADATA, title: 'Test Local Page', url: 'http://localhost' }
    );
    const [tabId, setTabId] = useState<number | null>(null);
    const [lookup, setLookup] = useState<PageLookup>(() =>
        isExtensionContext() ? { status: 'idle' } : { status: 'absent' }
    );

    const checkUrl = useCallback(async (url: string) => {
        setLookup({ status: 'checking' });
        const response = await sendMessage({ type: 'CHECK_PAGE', url });
        if (!response.success) {
            setLookup({ status: 'error', message: response.error });
        } else if (response.exists && response.pageId) {
            setLookup({
                status: 'found',
                pageId: response.pageId,
                summary: describeExisting(response.createdTime, response.description),
            });
        } else {
            setLookup({ status: 'absent' });
        }
    }, []);

    useEffect(() => {
        if (!isExtensionContext()) return;

        let cancelled = false;

        const load = async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (cancelled || !tab?.id) return;
            setTabId(tab.id);

            let metadata: PageMetadata | null = null;
            try {
                const [injection] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: collectPageMetadata,
                });
                metadata = (injection?.result as PageMetadata) ?? null;
            } catch {
                // Restricted pages (chrome://, the Web Store) cannot be scripted.
                metadata = null;
            }

            if (cancelled) return;
            const resolved = metadata ?? {
                ...EMPTY_METADATA,
                title: tab.title ?? '',
                url: tab.url ?? '',
            };
            setPageData(resolved);

            if (resolved.url) await checkUrl(resolved.url);
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [checkUrl]);

    const markSaved = useCallback((pageId: string) => {
        setLookup({ status: 'found', pageId, summary: 'Saved just now.' });
    }, []);

    return { pageData, tabId, lookup, markSaved };
};
