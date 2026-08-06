#!/usr/bin/env node
/**
 * Exercises the BUILT service worker (dist/src/background.js) against a fake
 * Notion API and a fake chrome.* surface.
 *
 * Unit tests cover the modules in isolation; this checks the bundle that
 * actually ships: that the listeners register, that messages dispatch, and that
 * saving really uses the column names discovered from the database.
 *
 * Usage: npm run build && node scripts/smoke-test.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIST_BACKGROUND = pathToFileURL(
    path.resolve(process.cwd(), 'dist/src/background.js')
).href;

// --- fake chrome.* -------------------------------------------------------

const storage = new Map();
const listeners = {};
const badge = { text: '', color: '' };

const asObject = (keys) => {
    const wanted = keys === undefined || keys === null
        ? [...storage.keys()]
        : Array.isArray(keys)
          ? keys
          : [keys];
    const result = {};
    for (const key of wanted) {
        if (storage.has(key)) result[key] = storage.get(key);
    }
    return result;
};

const register = (name) => ({
    addListener: (fn) => {
        listeners[name] = fn;
    },
});

globalThis.chrome = {
    storage: {
        local: {
            get: async (keys) => asObject(keys),
            set: async (items) => {
                for (const [key, value] of Object.entries(items)) storage.set(key, value);
            },
            remove: async (keys) => {
                for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
            },
        },
    },
    runtime: {
        id: 'test-extension',
        onMessage: register('message'),
        onInstalled: register('installed'),
        onStartup: register('startup'),
    },
    alarms: {
        get: async () => undefined,
        create: async () => {},
        onAlarm: register('alarm'),
    },
    contextMenus: {
        removeAll: (cb) => cb?.(),
        create: () => {},
        onClicked: register('contextMenu'),
    },
    commands: { onCommand: register('command') },
    action: {
        setBadgeText: async ({ text }) => {
            badge.text = text;
        },
        setBadgeBackgroundColor: async ({ color }) => {
            badge.color = color;
        },
    },
    tabs: { query: async () => [] },
    scripting: { executeScript: async () => [{ result: null }] },
};

// --- fake Notion ---------------------------------------------------------

const DATABASE = {
    id: 'db-1',
    // Deliberately none of the names the old client hardcoded.
    properties: {
        Name: { type: 'title' },
        URL: { type: 'url' },
        Notes: { type: 'rich_text' },
        Topics: { type: 'multi_select', multi_select: { options: [{ name: 'dev' }] } },
    },
};

const requests = [];
let queryResults = [];
let failCreatePage = false;

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });

    if (method === 'GET' && url.endsWith('/databases/db-1')) return json(DATABASE);

    if (method === 'POST' && url.endsWith('/databases/db-1/query')) {
        return json({ results: queryResults, next_cursor: null, has_more: false });
    }

    if (method === 'POST' && url.endsWith('/v1/pages')) {
        if (failCreatePage) throw new TypeError('Failed to fetch');
        return json({ id: 'page-1', url: 'https://www.notion.so/page-1' });
    }

    if (method === 'PATCH' && url.includes('/v1/pages/')) return json({ id: 'page-1' });
    if (method === 'PATCH' && url.includes('/children')) return json({ object: 'list' });

    throw new Error(`Unexpected request: ${method} ${url}`);
};

// --- harness -------------------------------------------------------------

await import(DIST_BACKGROUND);

const onMessage = listeners.message;
assert.ok(onMessage, 'the service worker registered no onMessage listener');

const send = (message) =>
    new Promise((resolve) => {
        const kept = onMessage(message, {}, resolve);
        if (kept !== true) resolve({ __unhandled: true });
    });

const lastRequest = (predicate) => [...requests].reverse().find(predicate);

/** Alarm and context-menu listeners are fire-and-forget, so poll for the effect. */
const waitFor = async (predicate, message, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
};

let failures = 0;
const check = async (name, fn) => {
    requests.length = 0;
    try {
        await fn();
        console.log(`  ok  ${name}`);
    } catch (err) {
        failures++;
        console.log(`FAIL  ${name}\n      ${err.message}`);
    }
};

console.log('\nservice worker smoke test (dist/src/background.js)\n');

await check('registers every entry point', () => {
    for (const name of ['message', 'installed', 'startup', 'alarm', 'contextMenu', 'command']) {
        assert.ok(listeners[name], `missing listener: ${name}`);
    }
});

await check('answers PING', async () => {
    assert.deepEqual(await send({ type: 'PING' }), { success: true, status: 'OK' });
});

await check('leaves the channel closed for unknown message types', async () => {
    assert.deepEqual(await send({ type: 'NOT_A_REAL_MESSAGE' }), { __unhandled: true });
});

await check('reports missing configuration instead of throwing', async () => {
    const response = await send({
        type: 'SAVE_PAGE',
        data: { url: 'https://a.test', title: 'A', description: '', tags: [] },
    });
    assert.equal(response.success, false);
    assert.match(response.error, /options/i);
});

storage.set('notionApiKey', 'ntn_test');
storage.set('notionDatabaseId', 'db-1');

await check('discovers the real column names', async () => {
    const response = await send({ type: 'FETCH_SCHEMA' });
    assert.equal(response.success, true);
    assert.equal(response.schema.titleProperty, 'Name');
    assert.equal(response.schema.urlProperty, 'URL');
    assert.equal(response.schema.descriptionProperty, 'Notes');
    assert.equal(response.schema.tagsProperty, 'Topics');
    assert.deepEqual(response.schema.tagOptions, ['dev']);
});

await check('reports an unsaved URL as absent', async () => {
    const response = await send({ type: 'CHECK_PAGE', url: 'https://a.test/new' });
    assert.equal(response.success, true);
    assert.equal(response.exists, false);
});

await check('saves using the discovered columns, not the defaults', async () => {
    const response = await send({
        type: 'SAVE_PAGE',
        data: {
            url: 'https://a.test/new',
            title: 'Hello',
            description: 'note',
            tags: ['dev, ops'],
            highlights: 'quoted',
        },
    });
    assert.equal(response.success, true, response.error);
    assert.equal(response.pageId, 'page-1');

    const create = lastRequest((r) => r.url.endsWith('/v1/pages') && r.method === 'POST');
    assert.ok(create, 'no page was created');
    const props = create.body.properties;
    assert.deepEqual(Object.keys(props).sort(), ['Name', 'Notes', 'Topics', 'URL']);
    assert.equal(props.Name.title[0].text.content, 'Hello');
    assert.equal(props.URL.url, 'https://a.test/new');
    // "dev, ops" must arrive as two options: Notion rejects commas in names.
    assert.deepEqual(props.Topics.multi_select, [{ name: 'dev' }, { name: 'ops' }]);
    // The database has no Highlights column, so it must be skipped, not sent.
    assert.equal(props.Highlights, undefined);
});

await check('appends clipped article blocks to the new page', async () => {
    const blocks = Array.from({ length: 120 }, (_, i) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: `para ${i}` } }] },
    }));
    const response = await send({
        type: 'SAVE_PAGE',
        data: { url: 'https://a.test/clip', title: 'Clip', description: '', tags: [] },
        clipBlocks: blocks,
    });
    assert.equal(response.success, true, response.error);
    assert.equal(response.clipped, 120);

    const appends = requests.filter((r) => r.url.includes('/children'));
    assert.equal(appends.length, 2, 'blocks were not split into 100-block batches');
    assert.equal(appends[0].body.children.length, 100);
    assert.equal(appends[1].body.children.length, 20);
});

await check('updates the existing row instead of duplicating it', async () => {
    queryResults = [
        {
            id: 'page-1',
            url: 'https://www.notion.so/page-1',
            created_time: '2026-01-01T00:00:00.000Z',
            properties: { Notes: { type: 'rich_text', rich_text: [{ plain_text: 'old' }] } },
        },
    ];
    const response = await send({
        type: 'SAVE_PAGE',
        data: { url: 'https://a.test/new', title: 'Hello again', description: '', tags: [] },
    });
    assert.equal(response.success, true, response.error);
    assert.equal(
        lastRequest((r) => r.url.endsWith('/v1/pages') && r.method === 'POST'),
        undefined,
        'a duplicate row was created'
    );
    assert.ok(lastRequest((r) => r.method === 'PATCH' && r.url.includes('/v1/pages/')));
    queryResults = [];
});

await check('maps saved links for the list', async () => {
    queryResults = [
        {
            id: 'page-9',
            url: 'https://www.notion.so/page-9',
            created_time: '2026-02-02T00:00:00.000Z',
            properties: {
                Name: { type: 'title', title: [{ plain_text: 'Saved item' }] },
                URL: { type: 'url', url: 'https://a.test/saved' },
                Notes: { type: 'rich_text', rich_text: [{ plain_text: 'a note' }] },
            },
        },
    ];
    const response = await send({ type: 'FETCH_LINKS', forceRefresh: true });
    assert.equal(response.success, true, response.error);
    assert.deepEqual(response.items, [
        {
            pageId: 'page-9',
            title: 'Saved item',
            url: 'https://a.test/saved',
            description: 'a note',
            createdTime: '2026-02-02T00:00:00.000Z',
            notionUrl: 'https://www.notion.so/page-9',
        },
    ]);
    queryResults = [];
});

await check('queues the save when Notion is unreachable', async () => {
    failCreatePage = true;
    const response = await send({
        type: 'SAVE_PAGE',
        data: { url: 'https://a.test/offline', title: 'Offline', description: '', tags: [] },
    });
    failCreatePage = false;

    assert.equal(response.success, false);
    assert.equal(response.queued, true, 'the save was lost instead of queued');

    const queue = storage.get('offlineQueue');
    assert.equal(queue.length, 1);
    assert.equal(queue[0].data.url, 'https://a.test/offline');
    assert.equal(badge.text, '1', 'the badge does not show the pending save');
});

await check('drains the queue when connectivity returns', async () => {
    listeners.alarm({ name: 'processOfflineQueue' });
    await waitFor(
        () => (storage.get('offlineQueue') || []).length === 0,
        'the queue was not drained'
    );
    assert.ok(
        lastRequest((r) => r.url.endsWith('/v1/pages') && r.method === 'POST'),
        'the queued page was never created'
    );
    await waitFor(() => badge.text === '', 'the badge still shows a pending save');
});

await check('ignores unrelated alarms', async () => {
    storage.set('offlineQueue', [
        {
            id: 'keep-me',
            data: { url: 'https://a.test/keep', title: 'Keep', description: '', tags: [] },
            attempts: 0,
            createdAt: Date.now(),
        },
    ]);
    listeners.alarm({ name: 'someOtherAlarm' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(storage.get('offlineQueue').length, 1, 'an unrelated alarm drained the queue');
    storage.set('offlineQueue', []);
});

console.log(
    failures === 0
        ? '\nall smoke checks passed\n'
        : `\n${failures} smoke check(s) failed\n`
);
process.exit(failures === 0 ? 0 : 1);
