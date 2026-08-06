import { useLayoutEffect, useRef, useState } from 'react';
import { useAiChat } from '../hooks/useAiChat';
import { sendMessage } from '../messages';
import type { PageMetadata } from '../types';

interface AiTabProps {
    pageData: PageMetadata | null;
    syncedPageId: string | null;
    /** The tab stays mounted while hidden, where scrolling has no effect. */
    visible: boolean;
}

export function AiTab({ pageData, syncedPageId, visible }: AiTabProps) {
    const { visibleMessages, loading, pending, send, approve, reject } = useAiChat(
        pageData,
        syncedPageId
    );
    const [input, setInput] = useState('');
    const [commentStatus, setCommentStatus] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Runs on becoming visible too: a hidden element has no scroll height, so
    // messages that arrived on another tab would otherwise stay scrolled off.
    useLayoutEffect(() => {
        if (!visible) return;
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [visible, visibleMessages, loading, pending]);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const value = input;
        setInput('');
        void send(value);
    };

    const handleAddComment = async (text: string) => {
        if (!syncedPageId) return;
        const response = await sendMessage({
            type: 'ADD_COMMENT_TO_PAGE',
            pageId: syncedPageId,
            text,
        });
        setCommentStatus(
            response.success ? 'Comment added in Notion.' : `Failed: ${response.error}`
        );
        setTimeout(() => setCommentStatus(''), 4000);
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col h-full overflow-hidden">
            <div
                ref={scrollRef}
                className="flex-1 bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 overflow-y-auto mb-3 flex flex-col gap-3"
            >
                <div className="text-sm text-neutral-300">
                    <span className="bg-indigo-900/50 text-indigo-300 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold mb-1 inline-block">
                        System
                    </span>
                    <p className="opacity-90 leading-relaxed text-[13px]">
                        The agent gets this page's title, URL and selection as context —
                        they are sent to your AI provider. What would you like to ask?
                    </p>
                </div>

                {visibleMessages.map((message, index) => (
                    <div
                        key={index}
                        className={`text-sm ${
                            message.role === 'user'
                                ? 'text-blue-300 bg-blue-900/20 ml-4 pl-3 py-2 pr-2 border-l-2 border-blue-500 rounded-r-lg'
                                : 'text-neutral-300 bg-neutral-700/30 mr-4 pr-3 py-2 pl-2 border-r-2 border-neutral-500 rounded-l-lg group relative'
                        }`}
                    >
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 block mb-0.5">
                            {message.role}
                        </span>
                        <p className="leading-relaxed text-[13px] whitespace-pre-wrap">
                            {message.content}
                        </p>

                        {message.role === 'assistant' && syncedPageId && (
                            <button
                                onClick={() => void handleAddComment(message.content)}
                                className="mt-2 text-[10px] font-bold tracking-wider uppercase bg-neutral-800 border border-neutral-600 px-2 py-1 rounded text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                                + Send to Notion
                            </button>
                        )}
                    </div>
                ))}

                {pending && (
                    <div className="bg-amber-900/20 border border-amber-500/40 rounded-lg p-3">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-amber-300 mb-1">
                            Confirm write to Notion
                        </div>
                        <p className="text-[13px] text-amber-100/90 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                            {pending.description}
                        </p>
                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={() => void approve()}
                                className="text-[11px] font-semibold px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                            >
                                Approve
                            </button>
                            <button
                                onClick={reject}
                                className="text-[11px] font-semibold px-3 py-1 rounded bg-neutral-800 border border-neutral-600 text-neutral-300 hover:text-white transition-colors"
                            >
                                Decline
                            </button>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="text-neutral-500 text-xs italic animate-pulse">
                        Agent is typing...
                    </div>
                )}
            </div>

            {commentStatus && (
                <p className="text-[11px] text-neutral-400 mb-2 text-center">{commentStatus}</p>
            )}

            <form onSubmit={handleSubmit} className="relative mt-auto shrink-0">
                <input
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    disabled={loading}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-shadow disabled:opacity-50"
                    placeholder="What is this page about?"
                />
                <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                        />
                    </svg>
                </button>
            </form>
        </div>
    );
}
