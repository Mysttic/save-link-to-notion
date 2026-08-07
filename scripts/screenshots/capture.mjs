#!/usr/bin/env node
/**
 * Renders the BUILT extension UI (dist/) with mocked chrome.* APIs and sample
 * data, and captures store-ready screenshots with headless Chrome.
 *
 * Usage: npm run build && node scripts/screenshots/capture.mjs
 * Output: docs/screenshots/*.png
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// execFile, not execFileSync: the file server runs in this same process, so a
// synchronous child would block the event loop and deadlock the capture.
const run = promisify(execFile);
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 4998;

const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

/** A neutral dot shown where the favicon would be, so list rows look complete. */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<circle cx="16" cy="16" r="12" fill="#4b5563"/><circle cx="16" cy="16" r="5" fill="#9ca3af"/></svg>`;

const MOCK = readFileSync(
    path.join(ROOT, 'scripts', 'screenshots', 'mock-chrome.js'),
    'utf8'
);

/** Serves dist/ verbatim, except HTML gets the mock injected before the bundle. */
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/__mock.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(MOCK);
        return;
    }
    if (url.pathname.startsWith('/_favicon/')) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(FAVICON_SVG);
        return;
    }

    const relative = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(DIST, relative);
    if (!file.startsWith(DIST) || !existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
    }

    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    if (type === 'text/html') {
        // justify-content centres the popup; height:auto lets it expand past its
        // fixed 520px so the clip checkbox and Save button are inside the frame.
        const html = readFileSync(file, 'utf8').replace(
            '<script',
            '<style>body{justify-content:center} #root>div{height:auto!important} *{transition:none!important;animation:none!important}</style>' +
                '<script src="/__mock.js"></script><script'
        );
        res.writeHead(200, { 'Content-Type': type });
        res.end(html);
        return;
    }

    res.writeHead(200, { 'Content-Type': type });
    res.end(readFileSync(file));
});

const SHOTS = [
    { name: 'save-tab', page: 'index.html', shot: 'save' },
    { name: 'saved-list', page: 'index.html', shot: 'saved' },
    { name: 'ai-approval', page: 'index.html', shot: 'ai' },
    { name: 'options', page: 'options.html', shot: 'options' },
];

const main = async () => {
    const chrome = CHROME_PATHS.find((candidate) => existsSync(candidate));
    if (!chrome) {
        console.error('No Chrome/Brave executable found for headless capture.');
        process.exit(1);
    }
    if (!existsSync(path.join(DIST, 'index.html'))) {
        console.error('dist/ is missing. Run: npm run build');
        process.exit(1);
    }

    mkdirSync(OUT, { recursive: true });
    await new Promise((resolve) => server.listen(PORT, resolve));

    const profile = path.join(os.tmpdir(), `sltn-shots-${process.pid}`);

    try {
        for (const { name, page, shot } of SHOTS) {
            const url = `http://localhost:${PORT}/${page}?shot=${shot}`;

            for (const [suffix, size, scale] of [
                ['-1280x800', '1280,800', 1],
                ['', '420,720', 2],
            ]) {
                // Options is a full page; only the popup states need the tight crop.
                if (page === 'options.html' && suffix === '') continue;

                const target = path.join(OUT, `${name}${suffix}.png`);
                await run(chrome, [
                    '--headless',
                    '--disable-gpu',
                    // The listing is English; without this dates render in the OS locale.
                    '--lang=en-US',
                    '--disable-extensions',
                    '--hide-scrollbars',
                    '--mute-audio',
                    `--user-data-dir=${profile}`,
                    `--window-size=${size}`,
                    `--force-device-scale-factor=${scale}`,
                    '--virtual-time-budget=10000',
                    `--screenshot=${target}`,
                    url,
                ]);
                console.log('captured', path.relative(ROOT, target));
            }
        }
    } finally {
        server.close();
        rmSync(profile, { recursive: true, force: true });
    }
};

main();
