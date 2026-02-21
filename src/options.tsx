import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

function Options() {
    const [apiKey, setApiKey] = useState('')
    const [databaseId, setDatabaseId] = useState('')
    const [openAiKey, setOpenAiKey] = useState('')
    const [aiModel, setAiModel] = useState('gpt-4o-mini')
    const [status, setStatus] = useState('')

    useEffect(() => {
        chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'openAiApiKey', 'aiModel'], (items) => {
            if (items.notionApiKey) setApiKey(String(items.notionApiKey))
            if (items.notionDatabaseId) setDatabaseId(String(items.notionDatabaseId))
            if (items.openAiApiKey) setOpenAiKey(String(items.openAiApiKey))
            if (items.aiModel) setAiModel(String(items.aiModel))
        })
    }, [])

    const handleSave = () => {
        chrome.storage.local.set(
            {
                notionApiKey: apiKey,
                notionDatabaseId: databaseId,
                openAiApiKey: openAiKey,
                aiModel: aiModel
            },
            () => {
                setStatus('Wymagane informacje zostały zapisane pomyślnie.')
                setTimeout(() => setStatus(''), 3000)
            }
        )
    }

    return (
        <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-xl p-8 bg-neutral-800 rounded-xl border border-neutral-700 shadow-2xl">
                <h1 className="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Save to Notion - Ustawienia</h1>

                <div className="mb-5">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Notion Internal API Key (Token)</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="secret_..."
                    />
                    <p className="text-xs text-neutral-500 mt-2">Klucz otrzymasz tworząc integrację w <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300">Notion Integrations</a>.</p>
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Notion Database ID</label>
                    <input
                        type="text"
                        value={databaseId}
                        onChange={(e) => setDatabaseId(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="np. c920ce23abcd1234abcd5678..."
                    />
                    <p className="text-xs text-neutral-500 mt-2">Znajdziesz to w adresie URL po otwarciu bazy w przeglądarce przed `?v=`.</p>
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">OpenRouter API Key (Dla Agenta AI)</label>
                    <input
                        type="password"
                        value={openAiKey}
                        onChange={(e) => setOpenAiKey(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        placeholder="sk-or-v1-..."
                    />
                </div>

                <div className="mb-8">
                    <label className="block text-sm font-medium text-neutral-300 mb-2">ID Modelu AI (z OpenRouter)</label>
                    <input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-neutral-200"
                        placeholder="np. openai/gpt-4o-mini lub anthropic/claude-3.5-sonnet"
                    />
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleSave}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    >
                        Zapisz ustawienia
                    </button>
                    {status && <span className="text-sm text-green-400">{status}</span>}
                </div>
            </div>
        </div>
    )
}

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Options />
    </React.StrictMode>
)
