import { useEffect, useRef, useState } from 'react';
import { TagPicker } from './TagPicker';
import { buildSummaryMessages, parseSummaryReply } from '../aiActions';
import { isExtensionContext, sendMessage } from '../messages';
import { extractArticleBlocks } from '../pageMetadata';
import type { PageLookup } from '../hooks/usePageMetadata';
import type { NotionPageData, PageMetadata } from '../types';

type SaveStatus = 'idle' | 'saving' | 'success' | 'queued' | 'error';

interface QueueFailure {
    title: string;
    url: string;
    error: string;
    failedAt: number;
}

interface SaveTabProps {
    pageData: PageMetadata | null;
    lookup: PageLookup;
    tabId: number | null;
    tagOptions: string[];
    onSaved: (pageId: string) => void;
}

export function SaveTab({ pageData, lookup, tabId, tagOptions, onSaved }: SaveTabProps) {
    const [note, setNote] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [clipArticle, setClipArticle] = useState(false);
    const [forceNew, setForceNew] = useState(false);
    const [status, setStatus] = useState<SaveStatus>('idle');
    const [message, setMessage] = useState('');
    const [summarizing, setSummarizing] = useState(false);
    const [failures, setFailures] = useState<QueueFailure[]>([]);

    const syncedPageId = lookup.status === 'found' ? lookup.pageId : null;
    const willUpdate = !forceNew && syncedPageId !== null;
    // Saving before the duplicate check returns would create a second row.
    const awaitingLookup =
        lookup.status === 'checking' || (lookup.status === 'idle' && !!pageData?.url);

    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleIdle = (delay: number) => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setStatus('idle'), delay);
    };

    useEffect(
        () => () => {
            if (idleTimer.current) clearTimeout(idleTimer.current);
        },
        []
    );

    useEffect(() => {
        if (!isExtensionContext()) return;
        void chrome.storage.local.get('queueFailures').then((store) => {
            if (Array.isArray(store.queueFailures)) setFailures(store.queueFailures);
        });
    }, []);

    const dismissFailures = () => {
        setFailures([]);
        if (isExtensionContext()) void chrome.storage.local.remove('queueFailures');
    };

    const collectClipBlocks = async (): Promise<unknown[] | undefined> => {
        if (!clipArticle || tabId === null || !isExtensionContext()) return undefined;
        try {
            const [injection] = await chrome.scripting.executeScript({
                target: { tabId },
                func: extractArticleBlocks,
            });
            const blocks = injection?.result as unknown[] | undefined;
            return blocks?.length ? blocks : undefined;
        } catch {
            // Clipping is best effort; the row is still worth saving without it.
            return undefined;
        }
    };

    const handleSave = async () => {
        if (!pageData || status === 'saving') return;
        if (idleTimer.current) clearTimeout(idleTimer.current);
        setStatus('saving');
        setMessage('');

        const clipBlocks = await collectClipBlocks();
        const description = note
            ? pageData.description
                ? `${note}\n\n${pageData.description}`
                : note
            : pageData.description;

        const data: NotionPageData = {
            url: pageData.url,
            title: pageData.title,
            description,
            tags: [...new Set([...tags, ...(pageData.type ? [pageData.type] : [])])],
            highlights: pageData.selectedText || undefined,
        };

        const response = await sendMessage({
            type: 'SAVE_PAGE',
            data,
            pageId: willUpdate ? syncedPageId! : undefined,
            clipBlocks,
            // Carried through so a queued retry still creates a separate row.
            forceNew: forceNew && syncedPageId !== null,
        });

        if (response.success) {
            if (response.pageId) onSaved(response.pageId);
            if (response.clipError) {
                setStatus('error');
                setMessage(`Saved, but the article could not be clipped: ${response.clipError}`);
                scheduleIdle(6000);
                return;
            }
            setStatus('success');
            setMessage(
                response.clipped
                    ? `Saved with ${response.clipped} clipped blocks.${
                          response.clipSkipped
                              ? ` ${response.clipSkipped} were rejected by Notion.`
                              : ''
                      }`
                    : ''
            );
            scheduleIdle(3000);
            return;
        }

        setStatus(response.queued ? 'queued' : 'error');
        setMessage(response.error);
        scheduleIdle(6000);
    };

    const handleSummarize = async () => {
        if (!pageData) return;
        setSummarizing(true);
        setMessage('');
        const response = await sendMessage({
            type: 'ASK_AI',
            messages: buildSummaryMessages(pageData),
        });
        setSummarizing(false);

        if (!response.success) {
            setStatus('error');
            setMessage(response.error);
            scheduleIdle(6000);
            return;
        }

        const summary = parseSummaryReply(response.reply);
        if (!summary) {
            setStatus('error');
            setMessage('The assistant did not return a usable summary.');
            scheduleIdle(6000);
            return;
        }

        setNote(summary.summary);
        setTags((previous) => [...new Set([...previous, ...summary.tags])]);
    };

    const buttonLabel =
        status === 'saving'
            ? 'Saving...'
            : status === 'success'
              ? 'Saved!'
              : awaitingLookup
                ? 'Checking...'
                : willUpdate
                  ? 'Update in Database'
                  : 'Save to Database';

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col overflow-y-auto -mr-1 pr-1">
            {failures.length > 0 && (
                <div className="mb-4 bg-amber-900/20 border border-amber-500/30 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-amber-200/90 leading-relaxed">
                            {failures.length} queued save
                            {failures.length === 1 ? '' : 's'} gave up after repeated
                            failures. Last error: {failures[0].error}
                        </p>
                        <button
                            onClick={dismissFailures}
                            className="text-[10px] uppercase tracking-wider text-amber-300/70 hover:text-amber-200"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            <div className="mb-4">
                <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">
                    Page Title & URL
                </label>
                <input
                    type="text"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none mb-2"
                    value={pageData?.title || 'Loading...'}
                    readOnly
                />
                <input
                    type="text"
                    className="w-full bg-neutral-800/50 border border-neutral-700/50 text-neutral-400 rounded-lg px-3 py-1.5 text-[11px] focus:outline-none"
                    value={pageData?.url || ''}
                    readOnly
                />
            </div>

            {pageData?.selectedText && (
                <div className="mb-4">
                    <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">
                        Highlight
                    </label>
                    <div className="w-full bg-indigo-900/30 border border-indigo-500/30 rounded-lg px-3 py-2 text-xs italic text-indigo-200 h-16 overflow-y-auto">
                        "{pageData.selectedText}"
                    </div>
                </div>
            )}

            {lookup.status === 'found' && (
                <div className="mb-4 bg-green-900/20 border border-green-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-green-400 mb-1">
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                        <span className="text-xs font-bold uppercase tracking-wider">
                            Already in Notion
                        </span>
                    </div>
                    <p className="text-xs text-green-200/80 leading-relaxed italic border-l-2 border-green-500/30 pl-2 mt-2">
                        {lookup.summary}
                    </p>
                </div>
            )}

            {lookup.status === 'error' && (
                <div className="mb-4 bg-amber-900/20 border border-amber-500/30 rounded-lg p-3">
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                        Could not check whether this page is already saved — saving may
                        create a duplicate. {lookup.message}
                    </p>
                </div>
            )}

            <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                        Note (Optional)
                    </label>
                    <button
                        onClick={handleSummarize}
                        disabled={summarizing || !pageData}
                        className="text-[10px] font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {summarizing ? 'Summarizing...' : '✦ AI summarize'}
                    </button>
                </div>
                <textarea
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm h-16 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                    placeholder="Add some context..."
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                />
            </div>

            <div className="mb-4">
                <TagPicker options={tagOptions} value={tags} onChange={setTags} />
            </div>

            <div className="mt-auto pt-2">
                <label className="flex items-center gap-2 mb-3 text-xs text-neutral-300 bg-neutral-800/50 p-2 rounded-lg border border-neutral-700 cursor-pointer hover:bg-neutral-800 transition-colors">
                    <input
                        type="checkbox"
                        className="rounded bg-neutral-900 border-neutral-600 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                        checked={clipArticle}
                        onChange={(event) => setClipArticle(event.target.checked)}
                    />
                    Clip full article into the Notion page
                </label>

                {syncedPageId && status !== 'success' && (
                    <label className="flex items-center justify-center gap-2 mb-3 text-xs text-neutral-300 bg-neutral-800/50 p-2 rounded-lg border border-neutral-700 cursor-pointer hover:bg-neutral-800 transition-colors">
                        <input
                            type="checkbox"
                            className="rounded bg-neutral-900 border-neutral-600 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                            checked={forceNew}
                            onChange={(event) => setForceNew(event.target.checked)}
                        />
                        Save as new (separate record)
                    </label>
                )}

                {status === 'error' && message && (
                    <p className="text-xs text-red-400 mb-2 text-center" title={message}>
                        {message}
                    </p>
                )}
                {status === 'queued' && (
                    <p className="text-xs text-amber-400 mb-2 text-center" title={message}>
                        Queued — will sync automatically once Notion is reachable.
                    </p>
                )}
                {status === 'success' && message && (
                    <p className="text-xs text-green-400 mb-2 text-center">{message}</p>
                )}

                <button
                    onClick={handleSave}
                    disabled={
                        status === 'saving' ||
                        status === 'success' ||
                        !pageData ||
                        awaitingLookup
                    }
                    className={`w-full text-white py-2.5 rounded-lg text-sm font-semibold transition-all shadow-[0_0_15px_rgba(79,70,229,0.4)] active:scale-[0.98] disabled:cursor-not-allowed
                     ${
                         status === 'saving'
                             ? 'bg-indigo-500 opacity-70'
                             : status === 'success'
                               ? 'bg-green-600 shadow-[0_0_15px_rgba(22,163,74,0.4)]'
                               : 'bg-indigo-600 hover:bg-indigo-500'
                     }`}
                >
                    {buttonLabel}
                </button>
            </div>
        </div>
    );
}
