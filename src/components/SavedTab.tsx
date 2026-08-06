import { useMemo } from 'react';
import { useSavedLinks } from '../hooks/useSavedLinks';
import { faviconFor, formatDate, openUrl } from '../utils';

export function SavedTab() {
    const {
        items,
        search,
        setSearch,
        hasMore,
        loading,
        loadingMore,
        error,
        refresh,
        loadMore,
    } = useSavedLinks();

    // Narrows the already loaded rows while the debounced server search is in
    // flight, so typing feels instant.
    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return items;
        return items.filter(
            (link) =>
                link.title.toLowerCase().includes(term) ||
                link.url.toLowerCase().includes(term)
        );
    }, [items, search]);

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-3 shrink-0">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search title or URL..."
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-shadow"
                    />
                    <svg
                        className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z"
                        />
                    </svg>
                </div>
                <button
                    onClick={refresh}
                    disabled={loading}
                    title="Refresh"
                    className="p-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-50"
                >
                    <svg
                        className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M4 4v5h.582M20 20v-5h-.581M5.5 9A7.5 7.5 0 0118.36 7M18.5 15A7.5 7.5 0 015.64 17"
                        />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto -mr-1 pr-1">
                {error && (
                    <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
                        {error}
                    </div>
                )}

                {!error && loading && items.length === 0 && (
                    <div className="flex flex-col gap-2">
                        {[0, 1, 2, 3].map((index) => (
                            <div
                                key={index}
                                className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3 animate-pulse"
                            >
                                <div className="h-3 w-2/3 bg-neutral-700 rounded mb-2" />
                                <div className="h-2 w-1/2 bg-neutral-700/70 rounded" />
                            </div>
                        ))}
                    </div>
                )}

                {!error && !loading && visible.length === 0 && (
                    <div className="text-center text-xs text-neutral-500 py-6">
                        {search
                            ? 'No saved links match your search.'
                            : 'No links saved yet. Use the "Save Link" tab to add some.'}
                    </div>
                )}

                <ul className="flex flex-col gap-2">
                    {visible.map((link) => {
                        const favicon = faviconFor(link.url);
                        return (
                            <li
                                key={link.pageId}
                                className="group bg-neutral-800/60 border border-neutral-700/70 rounded-lg p-2.5 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors"
                            >
                                <button
                                    onClick={() => openUrl(link.url)}
                                    className="w-full text-left flex items-start gap-2.5"
                                    title={link.url}
                                >
                                    {favicon ? (
                                        <img
                                            src={favicon}
                                            alt=""
                                            className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                                            onError={(event) => {
                                                event.currentTarget.style.visibility = 'hidden';
                                            }}
                                        />
                                    ) : (
                                        <div className="w-4 h-4 mt-0.5 rounded-sm bg-neutral-700 flex-shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-medium text-neutral-100 truncate group-hover:text-emerald-300">
                                            {link.title}
                                        </div>
                                        <div className="text-[11px] text-neutral-500 truncate">
                                            {link.url}
                                        </div>
                                        <div className="text-[10px] text-neutral-600 mt-0.5 uppercase tracking-wider">
                                            {formatDate(link.createdTime)}
                                        </div>
                                    </div>
                                </button>
                                <div className="flex justify-end gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => void navigator.clipboard.writeText(link.url)}
                                        className="text-[10px] font-bold tracking-wider uppercase bg-neutral-900 border border-neutral-700 px-2 py-0.5 rounded text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
                                        title="Copy link"
                                    >
                                        Copy
                                    </button>
                                    <button
                                        onClick={() => openUrl(link.notionUrl)}
                                        className="text-[10px] font-bold tracking-wider uppercase bg-neutral-900 border border-neutral-700 px-2 py-0.5 rounded text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
                                        title="Open in Notion"
                                    >
                                        Open in Notion
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>

                {hasMore && (
                    <button
                        onClick={loadMore}
                        disabled={loadingMore || loading}
                        className="w-full mt-3 py-2 text-xs font-semibold text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700/80 hover:text-white transition-colors disabled:opacity-50"
                    >
                        {loadingMore ? 'Loading...' : 'Load more'}
                    </button>
                )}
            </div>
        </div>
    );
}
