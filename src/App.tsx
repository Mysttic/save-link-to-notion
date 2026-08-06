import { useState } from 'react';
import './index.css';
import { AiTab } from './components/AiTab';
import { SaveTab } from './components/SaveTab';
import { SavedTab } from './components/SavedTab';
import { useDatabaseSchema } from './hooks/useDatabaseSchema';
import { usePageMetadata } from './hooks/usePageMetadata';
import { isExtensionContext } from './messages';

type TabKey = 'save' | 'saved' | 'ai';

const TABS: { key: TabKey; label: string; activeClass: string }[] = [
    { key: 'save', label: 'Save Link', activeClass: 'bg-neutral-600/50' },
    { key: 'saved', label: 'Saved', activeClass: 'bg-emerald-600/50' },
    { key: 'ai', label: 'Ask AI', activeClass: 'bg-blue-600/50' },
];

function App() {
    const [activeTab, setActiveTab] = useState<TabKey>('save');
    const { pageData, tabId, lookup, markSaved } = usePageMetadata();
    const schema = useDatabaseSchema();

    const syncedPageId = lookup.status === 'found' ? lookup.pageId : null;

    const openOptions = () => {
        if (isExtensionContext()) chrome.runtime.openOptionsPage();
    };

    return (
        <div className="w-[350px] h-[520px] bg-neutral-900 text-white p-4 font-sans flex flex-col overflow-hidden">
            <header className="flex items-center justify-between mb-4 border-b border-neutral-800 pb-3">
                <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Save to Notion
                </h1>
                <button
                    className="text-neutral-400 hover:text-white transition-colors"
                    title="Settings"
                    onClick={openOptions}
                >
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                    </svg>
                </button>
            </header>

            <div className="flex bg-neutral-800/80 rounded-lg p-1 mb-5 border border-neutral-700">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                            activeTab === tab.key
                                ? `${tab.activeClass} text-white shadow-sm`
                                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
                        }`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 flex flex-col relative overflow-hidden">
                {/* Save and Ask AI stay mounted so switching tabs does not discard a
                    half-written note or the chat history. Saved is mounted on demand
                    to avoid querying Notion every time the popup opens. */}
                <div className={activeTab === 'save' ? 'contents' : 'hidden'}>
                    <SaveTab
                        pageData={pageData}
                        lookup={lookup}
                        tabId={tabId}
                        tagOptions={schema?.tagOptions ?? []}
                        onSaved={markSaved}
                    />
                </div>
                {activeTab === 'saved' && <SavedTab />}
                <div className={activeTab === 'ai' ? 'contents' : 'hidden'}>
                    <AiTab
                        pageData={pageData}
                        syncedPageId={syncedPageId}
                        visible={activeTab === 'ai'}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;
