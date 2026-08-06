import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '../messages';
import type { SavedLinkItem } from '../types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Saved links list with cursor pagination and server-side search, so results
 * are not limited to the first page that happens to be loaded locally.
 */
export const useSavedLinks = () => {
    const [items, setItems] = useState<SavedLinkItem[]>([]);
    const [search, setSearch] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Only the newest request may write to state: a slow unfiltered fetch must
    // not overwrite the results of a search the user typed afterwards.
    const latestRequest = useRef(0);
    const cursorRef = useRef<string | null>(null);

    const load = useCallback(
        async (options: { append?: boolean; forceRefresh?: boolean; term?: string } = {}) => {
            const { append = false, forceRefresh = false, term = '' } = options;
            // Without a cursor an "append" would re-fetch page one and duplicate
            // every row; this happens if the list reloads while the button shows.
            if (append && !cursorRef.current) return;
            const requestId = ++latestRequest.current;

            if (append) setLoadingMore(true);
            else setLoading(true);
            setError(null);

            const response = await sendMessage({
                type: 'FETCH_LINKS',
                startCursor: append ? cursorRef.current : null,
                search: term,
                forceRefresh,
            });

            if (requestId !== latestRequest.current) return;

            setLoading(false);
            setLoadingMore(false);

            if (!response.success) {
                setError(response.error);
                if (!append) {
                    setItems([]);
                    // The cursor was reset before this request, so leaving
                    // hasMore on would show a "Load more" that can never load.
                    setHasMore(false);
                }
                return;
            }

            cursorRef.current = response.nextCursor;
            setHasMore(response.hasMore);
            setItems((previous) =>
                append ? [...previous, ...response.items] : response.items
            );
        },
        []
    );

    useEffect(() => {
        const timer = setTimeout(
            () => {
                cursorRef.current = null;
                void load({ term: search });
            },
            search ? SEARCH_DEBOUNCE_MS : 0
        );
        return () => clearTimeout(timer);
    }, [search, load]);

    const refresh = useCallback(() => {
        cursorRef.current = null;
        void load({ term: search, forceRefresh: true });
    }, [load, search]);

    const loadMore = useCallback(() => {
        void load({ term: search, append: true });
    }, [load, search]);

    return {
        items,
        search,
        setSearch,
        hasMore,
        loading,
        loadingMore,
        error,
        refresh,
        loadMore,
    };
};
