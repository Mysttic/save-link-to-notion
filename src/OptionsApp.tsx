import { useEffect, useState } from 'react';
import { sendMessage } from './messages';
import type { DatabaseSchema } from './types';
import type { NotionParentPage } from './notionClient';

const DEFAULT_MODEL = 'openai/gpt-4o-mini';

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

export function OptionsApp() {
    const [apiKey, setApiKey] = useState('');
    const [databaseId, setDatabaseId] = useState('');
    const [openAiKey, setOpenAiKey] = useState('');
    const [aiModel, setAiModel] = useState(DEFAULT_MODEL);
    const [feedback, setFeedback] = useState<Feedback>(null);

    const [schema, setSchema] = useState<DatabaseSchema | null>(null);
    const [testing, setTesting] = useState(false);

    const [parentPages, setParentPages] = useState<NotionParentPage[] | null>(null);
    const [parentPageId, setParentPageId] = useState('');
    const [databaseTitle, setDatabaseTitle] = useState('Saved Links');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        void chrome.storage.local
            .get(['notionApiKey', 'notionDatabaseId', 'openAiApiKey', 'aiModel'])
            .then((items) => {
                if (items.notionApiKey) setApiKey(String(items.notionApiKey));
                if (items.notionDatabaseId) setDatabaseId(String(items.notionDatabaseId));
                if (items.openAiApiKey) setOpenAiKey(String(items.openAiApiKey));
                if (items.aiModel) setAiModel(String(items.aiModel));
            });
    }, []);

    const persist = async (overrides: Record<string, string> = {}) => {
        await chrome.storage.local.set({
            notionApiKey: apiKey,
            notionDatabaseId: databaseId,
            openAiApiKey: openAiKey,
            aiModel: aiModel || DEFAULT_MODEL,
            ...overrides,
        });
    };

    const handleSave = async () => {
        await persist();
        setFeedback({ tone: 'ok', text: 'Settings saved.' });
        setTimeout(() => setFeedback(null), 3000);
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setSchema(null);
        await persist();
        const response = await sendMessage({ type: 'FETCH_SCHEMA', forceRefresh: true });
        setTesting(false);

        if (!response.success) {
            setFeedback({ tone: 'error', text: response.error });
            return;
        }
        setSchema(response.schema);
        setFeedback({ tone: 'ok', text: 'Connected. Column mapping detected below.' });
    };

    const handleLoadParents = async () => {
        if (!apiKey) {
            setFeedback({ tone: 'error', text: 'Enter your Notion API key first.' });
            return;
        }
        const response = await sendMessage({ type: 'SEARCH_PARENT_PAGES', apiKey });
        if (!response.success) {
            setFeedback({ tone: 'error', text: response.error });
            return;
        }
        setParentPages(response.pages);
        if (response.pages.length === 0) {
            setFeedback({
                tone: 'error',
                text: 'No pages shared with the integration. Open a page in Notion → ⋯ → Connections → add your integration.',
            });
        }
    };

    const handleCreateDatabase = async () => {
        if (!parentPageId) return;
        setCreating(true);
        const response = await sendMessage({
            type: 'CREATE_DATABASE',
            apiKey,
            parentPageId,
            title: databaseTitle || 'Saved Links',
        });
        setCreating(false);

        if (!response.success) {
            setFeedback({ tone: 'error', text: response.error });
            return;
        }

        setDatabaseId(response.databaseId);
        await persist({ notionDatabaseId: response.databaseId });
        setFeedback({ tone: 'ok', text: 'Database created and selected.' });
    };

    const inputClass =
        'w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all';

    return (
        <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-xl p-8 bg-neutral-800 rounded-xl border border-neutral-700 shadow-2xl">
                <h1 className="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Save to Notion – Settings
                </h1>

                <div className="mb-5">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                        Notion Internal API Key (Token)
                    </label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        className={inputClass}
                        placeholder="ntn_..."
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                        Create an integration in{' '}
                        <a
                            href="https://www.notion.so/my-integrations"
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:text-indigo-300"
                        >
                            Notion Integrations
                        </a>
                        . The key is stored unencrypted in this browser profile only — use an
                        integration scoped to a single database.
                    </p>
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                        Notion Database ID
                    </label>
                    <input
                        type="text"
                        value={databaseId}
                        onChange={(event) => setDatabaseId(event.target.value)}
                        className={inputClass}
                        placeholder="e.g. c920ce23abcd1234abcd5678..."
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                        The part of the database URL before <code>?v=</code>. Column names are
                        detected automatically, so they do not have to match exactly.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mt-3">
                        <button
                            onClick={handleTestConnection}
                            disabled={testing || !apiKey || !databaseId}
                            className="text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                        >
                            {testing ? 'Testing...' : 'Test connection'}
                        </button>
                        <button
                            onClick={handleLoadParents}
                            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            or create a new database…
                        </button>
                    </div>

                    {schema && (
                        <div className="mt-3 text-xs text-neutral-400 bg-neutral-900/70 border border-neutral-700 rounded-lg p-3 space-y-1">
                            <div>
                                Title column: <span className="text-neutral-200">{schema.titleProperty}</span>
                            </div>
                            <div>
                                URL column:{' '}
                                <span className="text-neutral-200">
                                    {schema.urlProperty ?? 'missing — duplicates cannot be detected'}
                                </span>
                            </div>
                            <div>
                                Note column:{' '}
                                <span className="text-neutral-200">
                                    {schema.descriptionProperty ?? 'missing — notes are skipped'}
                                </span>
                            </div>
                            <div>
                                Tags column:{' '}
                                <span className="text-neutral-200">
                                    {schema.tagsProperty ?? 'missing — tags are skipped'}
                                </span>
                            </div>
                            <div>
                                Highlights column:{' '}
                                <span className="text-neutral-200">
                                    {schema.highlightsProperty ?? 'missing — selections are skipped'}
                                </span>
                            </div>
                        </div>
                    )}

                    {parentPages && parentPages.length > 0 && (
                        <div className="mt-3 bg-neutral-900/70 border border-neutral-700 rounded-lg p-3">
                            <label className="block text-xs font-medium text-neutral-300 mb-2">
                                Create the database inside
                            </label>
                            <select
                                value={parentPageId}
                                onChange={(event) => setParentPageId(event.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">Select a page…</option>
                                {parentPages.map((page) => (
                                    <option key={page.id} value={page.id}>
                                        {page.title}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="text"
                                value={databaseTitle}
                                onChange={(event) => setDatabaseTitle(event.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="Database name"
                            />
                            <button
                                onClick={handleCreateDatabase}
                                disabled={!parentPageId || creating}
                                className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                            >
                                {creating ? 'Creating...' : 'Create database'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                        OpenRouter API Key (for the AI agent)
                    </label>
                    <input
                        type="password"
                        value={openAiKey}
                        onChange={(event) => setOpenAiKey(event.target.value)}
                        className={inputClass}
                        placeholder="sk-or-v1-..."
                    />
                </div>

                <div className="mb-8">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                        AI model ID (OpenRouter)
                    </label>
                    <input
                        type="text"
                        value={aiModel}
                        onChange={(event) => setAiModel(event.target.value)}
                        className={`${inputClass} text-neutral-200`}
                        placeholder={DEFAULT_MODEL}
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                        OpenRouter model IDs include the provider prefix, e.g.{' '}
                        <code>openai/gpt-4o-mini</code> or <code>anthropic/claude-sonnet-4.5</code>.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleSave}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    >
                        Save settings
                    </button>
                    {feedback && (
                        <span
                            className={`text-sm ${
                                feedback.tone === 'ok' ? 'text-green-400' : 'text-red-400'
                            }`}
                        >
                            {feedback.text}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
