// Injected before the built popup/options bundle so the real UI renders outside
// the extension. Implements just enough of chrome.* with sample data to show
// each feature state; ?shot=<name> picks the state and drives the UI to it.
(() => {
    const shot = new URLSearchParams(location.search).get('shot') || 'save';

    const PAGE_ALREADY_SAVED = shot === 'ai';

    const SETTINGS = {
        notionApiKey: 'ntn_51a9c0f8e2b74d16a3c58e97d20b4f61',
        notionDatabaseId: 'a1b2c3d4e5f64789ab12cd34ef567890',
        openAiApiKey: 'sk-or-v1-9f8e7d6c5b4a39281706f5e4d3c2b1a0',
        aiModel: 'openai/gpt-4o-mini',
    };

    const SCHEMA = {
        titleProperty: 'Title',
        urlProperty: 'Link',
        descriptionProperty: 'Description',
        tagsProperty: 'Tags',
        highlightsProperty: 'Highlights',
        sessionIdProperty: null,
        tagOptions: ['productivity', 'notion', 'reading', 'dev'],
    };

    const PAGE = {
        title: 'Building a Second Brain in Notion',
        url: 'https://maria.dev/blog/second-brain-in-notion',
        description:
            'A practical system for capturing, organising and resurfacing everything you read online.',
        image: '',
        type: 'article',
        selectedText: 'Your notes are only as useful as your ability to find them again.',
        images: [],
    };

    const SAVED_ITEMS = [
        {
            pageId: 'p1',
            title: 'Building a Second Brain in Notion',
            url: 'https://maria.dev/blog/second-brain-in-notion',
            description: 'A practical system for capturing and organising.',
            createdTime: '2026-08-07T18:20:00.000Z',
            notionUrl: 'https://www.notion.so/p1',
        },
        {
            pageId: 'p2',
            title: 'You Might Not Need an Effect – React docs',
            url: 'https://react.dev/learn/you-might-not-need-an-effect',
            description: '',
            createdTime: '2026-08-05T09:11:00.000Z',
            notionUrl: 'https://www.notion.so/p2',
        },
        {
            pageId: 'p3',
            title: 'The Grug Brained Developer',
            url: 'https://grugbrain.dev/',
            description: 'A layman’s guide to thinking like the self-aware smol brained.',
            createdTime: '2026-08-03T21:47:00.000Z',
            notionUrl: 'https://www.notion.so/p3',
        },
        {
            pageId: 'p4',
            title: 'Chrome Extensions: Migrate to Manifest V3',
            url: 'https://developer.chrome.com/docs/extensions/develop/migrate',
            description: '',
            createdTime: '2026-07-28T14:02:00.000Z',
            notionUrl: 'https://www.notion.so/p4',
        },
        {
            pageId: 'p5',
            title: 'Notion API reference',
            url: 'https://developers.notion.com/reference/intro',
            description: 'Endpoints, pagination, rate limits.',
            createdTime: '2026-07-25T08:30:00.000Z',
            notionUrl: 'https://www.notion.so/p5',
        },
    ];

    const AI_REPLY = [
        'The article lays out a "second brain" workflow: capture ideas the moment they appear, organise notes by how actionable they are rather than by topic, and resurface them with a weekly review. I can add a short summary to your Notion page.',
        '<action>{"type":"append_text","text":"Second Brain – key points:\\n• Capture ideas the moment they appear\\n• Organise by actionability, not by topic\\n• Resurface notes with a weekly review"}</action>',
    ].join('\n');

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const respond = async (message) => {
        await sleep(20);
        switch (message.type) {
            case 'PING':
                return { success: true, status: 'OK' };
            case 'CHECK_PAGE':
                return PAGE_ALREADY_SAVED
                    ? {
                          success: true,
                          exists: true,
                          pageId: 'p1',
                          description: 'Read later — solid overview of the capture workflow.',
                          createdTime: '2026-08-02T10:00:00.000Z',
                      }
                    : { success: true, exists: false, pageId: null, description: '', createdTime: null };
            case 'FETCH_SCHEMA':
                return { success: true, schema: SCHEMA };
            case 'FETCH_LINKS':
                return {
                    success: true,
                    items: SAVED_ITEMS,
                    nextCursor: null,
                    hasMore: true,
                    fromCache: false,
                };
            case 'ASK_AI':
                return { success: true, reply: AI_REPLY };
            case 'SAVE_PAGE':
                return { success: true, pageId: 'p1', clipped: 0, clipSkipped: 0 };
            case 'QUEUE_STATUS':
                return { success: true, pending: 0 };
            default:
                return { success: true };
        }
    };

    const storageData = { ...SETTINGS };
    const pick = (keys) => {
        const wanted = keys == null ? Object.keys(storageData) : [].concat(keys);
        const out = {};
        for (const key of wanted) {
            if (key in storageData) out[key] = storageData[key];
        }
        return out;
    };

    window.chrome = {
        runtime: {
            id: 'screenshot-harness',
            sendMessage: (message) => respond(message),
            openOptionsPage: () => {},
            getURL: (path) => new URL(path, location.origin).toString(),
        },
        storage: {
            local: {
                get: (keys, callback) => {
                    const result = pick(keys);
                    if (callback) callback(result);
                    return Promise.resolve(result);
                },
                set: (items, callback) => {
                    Object.assign(storageData, items);
                    if (callback) callback();
                    return Promise.resolve();
                },
                remove: () => Promise.resolve(),
            },
        },
        tabs: {
            query: (_query, callback) => {
                const tabs = [{ id: 1, title: PAGE.title, url: PAGE.url }];
                if (callback) callback(tabs);
                return Promise.resolve(tabs);
            },
            create: () => {},
        },
        scripting: {
            executeScript: (_injection, callback) => {
                const results = [{ result: PAGE }];
                if (callback) callback(results);
                return Promise.resolve(results);
            },
        },
    };

    // --- drive the UI into the requested state --------------------------------

    const setReactInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        ).set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const buttonByText = (text) =>
        [...document.querySelectorAll('button')].find((button) =>
            button.textContent.trim().toLowerCase().includes(text.toLowerCase())
        );

    const waitFor = async (find, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const found = find();
            if (found) return found;
            await sleep(50);
        }
        throw new Error('screenshot driver timed out');
    };

    window.addEventListener('load', async () => {
        try {
            if (shot === 'saved') {
                (await waitFor(() => buttonByText('Saved'))).click();
                await waitFor(() => document.querySelector('li'));
            } else if (shot === 'ai') {
                (await waitFor(() => buttonByText('Ask AI'))).click();
                const input = await waitFor(() =>
                    document.querySelector('input[placeholder="What is this page about?"]')
                );
                setReactInput(input, 'What is this article about? Add a summary to my Notion page.');
                await sleep(100);
                input.closest('form').requestSubmit();
                await waitFor(() => buttonByText('Approve'));
            } else if (shot === 'options') {
                (await waitFor(() => buttonByText('Test connection'))).click();
                await waitFor(() =>
                    [...document.querySelectorAll('div')].some((el) =>
                        el.textContent.includes('Title column')
                    )
                );
            }
            document.title = `ready:${shot}`;
        } catch (err) {
            document.title = `error:${shot}:${err.message}`;
        }
    });
})();
