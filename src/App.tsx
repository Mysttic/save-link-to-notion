import { useState, useEffect, useMemo } from 'react'
import './index.css'

type SavedLink = {
  pageId: string
  title: string
  url: string
  description: string
  createdTime: string
  notionUrl: string
}

function App() {
  const [activeTab, setActiveTab] = useState('save')
  const [pageData, setPageData] = useState<any>(null)
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Two-way sync state
  const [existingNote, setExistingNote] = useState<string | null>(null)
  const [syncedPageId, setSyncedPageId] = useState<string | null>(null)
  const [forceNew, setForceNew] = useState(false)

  // AI Chat State
  const [chatMessages, setChatMessages] = useState<{ role: string, content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)

  // Saved Links State
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([])
  const [savedNextCursor, setSavedNextCursor] = useState<string | null>(null)
  const [savedHasMore, setSavedHasMore] = useState(false)
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedLoadingMore, setSavedLoadingMore] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [savedSearch, setSavedSearch] = useState('')
  const [savedLoaded, setSavedLoaded] = useState(false)

  const loadSavedLinks = (opts: { append?: boolean; forceRefresh?: boolean } = {}) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return

    const append = !!opts.append
    if (append) {
      setSavedLoadingMore(true)
    } else {
      setSavedLoading(true)
    }
    setSavedError(null)

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_LINKS',
        startCursor: append ? savedNextCursor : null,
        forceRefresh: !!opts.forceRefresh,
      },
      (response) => {
        setSavedLoading(false)
        setSavedLoadingMore(false)
        setSavedLoaded(true)
        if (response?.success) {
          const items: SavedLink[] = response.items || []
          setSavedLinks((prev) => (append ? [...prev, ...items] : items))
          setSavedNextCursor(response.nextCursor || null)
          setSavedHasMore(!!response.hasMore)
        } else {
          setSavedError(response?.error || 'Failed to load saved links')
          if (!append) setSavedLinks([])
        }
      }
    )
  }

  // Load saved links the first time the user opens the "Saved" tab
  useEffect(() => {
    if (activeTab === 'saved' && !savedLoaded && !savedLoading) {
      loadSavedLinks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Client-side filtering for instant feedback while typing
  const filteredSavedLinks = useMemo(() => {
    const q = savedSearch.trim().toLowerCase()
    if (!q) return savedLinks
    return savedLinks.filter(
      (l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q)
    )
  }, [savedLinks, savedSearch])

  const openUrl = (url: string) => {
    if (!url) return
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url })
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const faviconFor = (url: string) => {
    try {
      const u = new URL(url)
      return `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`
    } catch {
      return ''
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  useEffect(() => {
    // Get active tab metadata
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if (tab?.id) {
          // Execute content script function to get metadata
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Same exact logic as content script, fallback if not injected
              const getMetaContent = (name: string): string => {
                const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                return el ? el.getAttribute('content') || '' : '';
              };
              return {
                title: document.title,
                url: window.location.href,
                description: getMetaContent('description') || getMetaContent('og:description'),
                image: getMetaContent('image') || getMetaContent('og:image'),
                type: getMetaContent('og:type'),
                selectedText: window.getSelection()?.toString() || '',
                images: Array.from(document.images).map(img => img.src).filter(src => src && src.startsWith('http')).slice(0, 15)
              };
            }
          }, (results) => {
            if (results && results[0] && results[0].result) {
              const data = results[0].result;
              setPageData(data)

              // Check if URL exists in Notion
              chrome.runtime.sendMessage({ type: 'CHECK_PAGE', url: data.url }, (res) => {
                if (res?.success && res?.exists) {
                  setExistingNote(res.summary)
                  setSyncedPageId(res.pageId)
                }
              })

            } else {
              setPageData({ title: tab.title, url: tab.url, selectedText: '' })
            }
          })
        }
      })
    } else {
      // Mock data for local testing
      setPageData({ title: 'Test Local Page', url: 'http://localhost' })
    }
  }, [])

  const handleSave = () => {
    if (!pageData) return
    setStatus('saving')

    const dataToSend = {
      ...pageData,
      description: note ? `${note}\n\n${pageData.description || ''}` : pageData.description,
      tags: pageData.type ? [pageData.type] : []
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'SAVE_PAGE',
        data: dataToSend,
        pageId: (!forceNew && syncedPageId) ? syncedPageId : undefined
      }, (response) => {
        console.log('[App] SAVE_PAGE response:', response)
        if (response?.success) {
          setStatus('success')
          if (response?.result?.id) {
            setSyncedPageId(response.result.id)
            setExistingNote(`Saved just now.`)
          }
          setTimeout(() => setStatus('idle'), 3000)
        } else {
          setStatus('error')
          const errMsg = response?.error || (response?.queued ? 'Saved to offline queue (check background console for details)' : 'Unknown Error')
          setErrorMsg(errMsg)
          console.error('[App] Save failed:', errMsg, '| full response:', response)
          setTimeout(() => setStatus('idle'), 6000)
        }
      })
    } else {
      setTimeout(() => setStatus('success'), 1000) // local dev
    }
  }

  const handleAskAI = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!chatInput.trim() || isChatLoading) return

    const userMsg = { role: 'user', content: chatInput }

    // Initial context system message if this is the first interaction
    let currentMsgs = [...chatMessages]
    if (currentMsgs.length === 0 && pageData) {
      const imgContext = (pageData.images || []).map((_: string, i: number) => `IMG_${i}`).join(', ');
      const context = `Context: This is a webpage titled "${pageData.title}" at URL: ${pageData.url}.\nDescription: ${pageData.description}\nSelected Text: ${pageData.selectedText || 'None'}\nFound Images: ${imgContext || 'None'}`;
      currentMsgs.push({
        role: 'system', content: `You are a helpful AI assistant inside a Notion web clipper. Answer strictly based on the provided context if relevant.\n\nCRITICAL AI ACTION PROTOCOL:\nYou cannot click, but you CAN execute special commands by returning a JSON inside an <action> tag. 
If the user explicitly asks you to save or add IMAGES to Notion, respond with this exact format:
<action>{"type": "append_images", "image_ids": ["IMG_0", "IMG_1"]}</action>
You can include up to 10 image IDs from the 'Found Images' list context (do not hallucinate IDs).
If the user explicitly asks you to save or add TEXT/details/summaries directly to Notion, respond with this exact format:
<action>{"type": "append_text", "text": "Your formatted text here..."}</action>
Do not use <action> unless the user explicitly asks to "add/save to Notion". When just answering questions, use plain text.\n\n${context}`
      });
    }

    currentMsgs.push(userMsg)
    setChatMessages([...currentMsgs])
    setChatInput('')
    setIsChatLoading(true)

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'ASK_AI', messages: currentMsgs }, (response) => {
        setIsChatLoading(false)
        if (response?.success) {
          const replyText = response.reply;
          const actionMatch = replyText.match(/<action>([\s\S]*?)(?:<\/action>|$)/);

          if (actionMatch) {
            const textOutsideAction = replyText.replace(/<action>[\s\S]*?(?:<\/action>|$)/, '').trim();
            const prefixMsg = textOutsideAction ? `${textOutsideAction}\n\n` : '';

            try {
              let jsonStr = actionMatch[1].trim();
              jsonStr = jsonStr.replace(/^```json/i, '').replace(/```$/i, '').trim();
              const actionJson = JSON.parse(jsonStr);

              if (actionJson.type === 'append_images' && actionJson.image_ids && Array.isArray(actionJson.image_ids)) {

                const urlsToAppend = actionJson.image_ids
                  .map((id: string) => {
                    const match = id.match(/IMG_(\d+)/);
                    return match ? (pageData?.images || [])[parseInt(match[1], 10)] : null;
                  })
                  .filter((url: string | null | undefined) => !!url);

                if (urlsToAppend.length === 0) {
                  setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] No valid image IDs found in AI response.` }]);
                  return;
                }

                if (syncedPageId) {
                  chrome.runtime.sendMessage({ type: 'APPEND_BLOCKS', pageId: syncedPageId, urls: urlsToAppend }, (res) => {
                    if (res?.success) {
                      setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System] Successfully appended ${urlsToAppend.length} image(s) to Notion.` }]);
                    } else {
                      setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] Failed to add images: ${res?.error}` }]);
                    }
                  });
                } else {
                  setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] Page is not saved in Notion. Save it first before adding images.` }]);
                }
              } else if (actionJson.type === 'append_text' && actionJson.text) {
                if (syncedPageId) {
                  chrome.runtime.sendMessage({ type: 'APPEND_TEXT_BLOCKS', pageId: syncedPageId, text: actionJson.text }, (res) => {
                    if (res?.success) {
                      setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System] Successfully appended the generated text to Notion.` }]);
                    } else {
                      setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] Failed to add text: ${res?.error}` }]);
                    }
                  });
                } else {
                  setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] Page is not saved in Notion. Save it first before adding text.` }]);
                }
              } else {
                setChatMessages((prev) => [...prev, { role: 'assistant', content: replyText }])
              }
            } catch (e) {
              setChatMessages((prev) => [...prev, { role: 'assistant', content: `${prefixMsg}[System Error] Failed to parse action (model truncated?): ${e}, Raw: ${actionMatch[1].substring(0, 100)}...` }]);
            }
          } else {
            setChatMessages((prev) => [...prev, { role: 'assistant', content: replyText }])
          }
        } else {
          setChatMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${response?.error}` }])
        }
      })
    } else {
      setTimeout(() => {
        setIsChatLoading(false)
        setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Mock response in local dev mode.' }])
      }, 1000)
    }
  }

  const handleAddComment = (text: string) => {
    if (!syncedPageId) return;

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'ADD_COMMENT_TO_PAGE', pageId: syncedPageId, text: text }, (response) => {
        if (response?.success) {
          alert('Comment saved successfully in Notion!');
        } else {
          alert(`Save error: ${response?.error}`);
        }
      })
    }
  }

  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.openOptionsPage();
    }
  }

  return (
    <div className="w-[350px] min-h-[400px] bg-neutral-900 text-white p-4 font-sans flex flex-col overflow-hidden">
      <header className="flex items-center justify-between mb-4 border-b border-neutral-800 pb-3">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
          Save to Notion
        </h1>
        <button className="text-neutral-400 hover:text-white transition-colors" title="Settings" onClick={openOptions}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
        </button>
      </header>

      <div className="flex bg-neutral-800/80 rounded-lg p-1 mb-5 border border-neutral-700">
        <button
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'save' ? 'bg-neutral-600/50 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'}`}
          onClick={() => setActiveTab('save')}
        >
          Save Link
        </button>
        <button
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'saved' ? 'bg-emerald-600/50 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'}`}
          onClick={() => setActiveTab('saved')}
        >
          Saved
        </button>
        <button
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'ai' ? 'bg-blue-600/50 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'}`}
          onClick={() => setActiveTab('ai')}
        >
          Ask AI
        </button>
      </div>

      <div className="flex-1 flex flex-col relative">
        {activeTab === 'save' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col">
            <div className="mb-4">
              <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">Page Title & URL</label>
              <input type="text" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none mb-2" value={pageData?.title || 'Loading...'} readOnly />
              <input type="text" className="w-full bg-neutral-800/50 border border-neutral-700/50 text-neutral-400 rounded-lg px-3 py-1.5 text-[11px] focus:outline-none" value={pageData?.url || ''} readOnly />
            </div>
            {pageData?.selectedText && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">Highlight</label>
                <div className="w-full bg-indigo-900/30 border border-indigo-500/30 rounded-lg px-3 py-2 text-xs italic text-indigo-200 h-16 overflow-y-auto">
                  "{pageData.selectedText}"
                </div>
              </div>
            )}

            {existingNote && (
              <div className="mb-4 bg-green-900/20 border border-green-500/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-green-400 mb-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  <span className="text-xs font-bold uppercase tracking-wider">Already in Notion</span>
                </div>
                <p className="text-xs text-green-200/80 leading-relaxed italic border-l-2 border-green-500/30 pl-2 mt-2">
                  {existingNote}
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">Note (Optional)</label>
              <textarea
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm h-16 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                placeholder="Add some context..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              ></textarea>
            </div>

            <div className="mt-auto">
              {syncedPageId && status !== 'success' && (
                <label className="flex items-center justify-center gap-2 mb-3 text-xs text-neutral-300 bg-neutral-800/50 p-2 rounded-lg border border-neutral-700 cursor-pointer hover:bg-neutral-800 transition-colors">
                  <input type="checkbox" className="rounded bg-neutral-900 border-neutral-600 text-indigo-500 focus:ring-indigo-500 cursor-pointer" checked={forceNew} onChange={(e) => setForceNew(e.target.checked)} />
                  Save as new (separate record)
                </label>
              )}
              {status === 'error' && <p className="text-xs text-red-400 mb-2 truncate text-center" title={errorMsg}>{errorMsg}</p>}
              <button
                onClick={handleSave}
                disabled={status === 'saving' || status === 'success'}
                className={`w-full text-white py-2.5 rounded-lg text-sm font-semibold transition-all shadow-[0_0_15px_rgba(79,70,229,0.4)] active:scale-[0.98]
                 ${status === 'saving' ? 'bg-indigo-500 opacity-70' :
                    status === 'success' ? 'bg-green-600 shadow-[0_0_15px_rgba(22,163,74,0.4)]' :
                      'bg-indigo-600 hover:bg-indigo-500'}`}
              >
                {status === 'saving' ? 'Saving...' : status === 'success' ? 'Saved!' : (!forceNew && syncedPageId) ? 'Update in Database' : 'Save to Database'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'saved' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  placeholder="Search title or URL..."
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-shadow"
                />
                <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z" />
                </svg>
              </div>
              <button
                onClick={() => loadSavedLinks({ forceRefresh: true })}
                disabled={savedLoading}
                title="Refresh"
                className="p-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${savedLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582M20 20v-5h-.581M5.5 9A7.5 7.5 0 0118.36 7M18.5 15A7.5 7.5 0 015.64 17" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto -mr-1 pr-1">
              {savedError && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
                  {savedError}
                </div>
              )}

              {!savedError && savedLoading && savedLinks.length === 0 && (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3 animate-pulse">
                      <div className="h-3 w-2/3 bg-neutral-700 rounded mb-2"></div>
                      <div className="h-2 w-1/2 bg-neutral-700/70 rounded"></div>
                    </div>
                  ))}
                </div>
              )}

              {!savedError && !savedLoading && filteredSavedLinks.length === 0 && (
                <div className="text-center text-xs text-neutral-500 py-6">
                  {savedSearch
                    ? 'No saved links match your search.'
                    : 'No links saved yet. Use the "Save Link" tab to add some.'}
                </div>
              )}

              <ul className="flex flex-col gap-2">
                {filteredSavedLinks.map((link) => {
                  const fav = faviconFor(link.url)
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
                        {fav ? (
                          <img
                            src={fav}
                            alt=""
                            className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                          />
                        ) : (
                          <div className="w-4 h-4 mt-0.5 rounded-sm bg-neutral-700 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-neutral-100 truncate group-hover:text-emerald-300">
                            {link.title}
                          </div>
                          <div className="text-[11px] text-neutral-500 truncate">{link.url}</div>
                          <div className="text-[10px] text-neutral-600 mt-0.5 uppercase tracking-wider">
                            {formatDate(link.createdTime)}
                          </div>
                        </div>
                      </button>
                      <div className="flex justify-end mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openUrl(link.notionUrl)}
                          className="text-[10px] font-bold tracking-wider uppercase bg-neutral-900 border border-neutral-700 px-2 py-0.5 rounded text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
                          title="Open in Notion"
                        >
                          Open in Notion
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {savedHasMore && !savedSearch && (
                <button
                  onClick={() => loadSavedLinks({ append: true })}
                  disabled={savedLoadingMore}
                  className="w-full mt-3 py-2 text-xs font-semibold text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700/80 hover:text-white transition-colors disabled:opacity-50"
                >
                  {savedLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex-1 bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 overflow-y-auto mb-3 flex flex-col gap-3">
              <div className="text-sm text-neutral-300">
                <span className="bg-indigo-900/50 text-indigo-300 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold mb-1 inline-block">System</span>
                <p className="opacity-90 leading-relaxed text-[13px]">The agent has context of this page. What would you like to ask?</p>
              </div>
              {chatMessages.map((msg, idx) => (
                msg.role !== 'system' && (
                  <div key={idx} className={`text-sm ${msg.role === 'user' ? 'text-blue-300 bg-blue-900/20 ml-4 pl-3 py-2 pr-2 border-l-2 border-blue-500 rounded-r-lg' : 'text-neutral-300 bg-neutral-700/30 mr-4 pr-3 py-2 pl-2 border-r-2 border-neutral-500 rounded-l-lg group relative'}`}>
                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 block mb-0.5">{msg.role}</span>
                    <p className="leading-relaxed text-[13px] whitespace-pre-wrap">{msg.content}</p>

                    {msg.role === 'assistant' && syncedPageId && (
                      <button
                        onClick={() => handleAddComment(msg.content)}
                        className="mt-2 text-[10px] font-bold tracking-wider uppercase bg-neutral-800 border border-neutral-600 px-2 py-1 rounded text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        + Send to Notion
                      </button>
                    )}
                  </div>
                )
              ))}
              {isChatLoading && (
                <div className="text-neutral-500 text-xs italic animate-pulse">Agent is typing...</div>
              )}
            </div>
            <form onSubmit={handleAskAI} className="relative mt-auto shrink-0">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatLoading}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-shadow disabled:opacity-50"
                placeholder="What is this page about?"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isChatLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
