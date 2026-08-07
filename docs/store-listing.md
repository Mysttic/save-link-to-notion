# Chrome Web Store submission notes

Answers for the Developer Dashboard forms. Keep this in sync with
`public/manifest.json` — the reviewer compares the two.

## Version 1.1.0

Permissions changed substantially versus 1.0.x, so expect a full review rather
than a fast-tracked update.

| | 1.0.x | 1.1.0 |
|---|---|---|
| `host_permissions` | `*://api.notion.com/`, `<all_urls>` | `https://api.notion.com/*`, `https://openrouter.ai/*` |
| content scripts | injected on `<all_urls>` | none |
| `permissions` | activeTab, storage, scripting, alarms | + contextMenus, favicon |

The direction is strictly narrowing: the extension no longer requests access to
every site, and no longer injects anything into pages the user is not acting on.

## Single purpose

Save the page you are viewing — its title, URL, note, tags and selected text,
and optionally its article body — into a Notion database you own, and answer
questions about that page with an AI assistant of your choosing.

## Permission justifications

**activeTab** — When you open the popup, use the right-click menu, or press the
save shortcut, the extension reads the current tab's title, meta description and
selected text so it can fill in the record. Access is granted by that gesture and
covers only that tab.

**scripting** — Used to run one function in the active tab that returns its
metadata, and, when "Clip full article" is ticked, one that returns the readable
article body as Notion blocks. No script is injected into any page the user has
not acted on.

**storage** — Stores your Notion API key, database ID, optional AI provider key
and model, the cached column mapping of your database, and the queue of saves
waiting for connectivity. Everything stays on the device; nothing is sent to the
developer.

**alarms** — Wakes the service worker every two minutes to retry saves that were
queued because Notion was unreachable.

**contextMenus** — Adds "Save this page / Save link / Save selection to Notion"
to the right-click menu.

**favicon** — Shows site icons next to entries in the Saved list, read from the
browser's own favicon cache. Chosen specifically so the extension does not have
to call a third-party favicon service, which would disclose the domains of your
saved links.

**https://api.notion.com/\*** — The Notion API. Every save, lookup and query goes
here, authenticated with the integration token you provide.

**https://openrouter.ai/\*** — The AI provider, contacted only when you use the
"Ask AI" tab or the "AI summarize" button, and only if you configured a key.

## Remote code

No. The extension executes no remote code. Everything is bundled at build time;
the only network calls are JSON requests to the Notion and OpenRouter APIs.

## Data usage disclosure

Collected and handled:

- **Website content** — Page title, URL, meta description and text you selected
  are sent to Notion when you save, and to your chosen AI provider when you use
  the AI features. With "Clip full article" ticked, the article body is also sent
  to Notion.
- **Authentication information** — Your Notion and AI provider API keys are
  stored locally so requests can be made on your behalf.

Certifications:

- Not sold to third parties.
- Not used or transferred for any purpose unrelated to the single purpose above.
- Not used or transferred to determine creditworthiness or for lending.

No analytics, no tracking, no data sent to the developer. See `PRIVACY.md`.

## Pre-submission checklist

- [ ] `npm run lint`, `npm test`, `npm run smoke` all pass
- [ ] `public/manifest.json` version is higher than the published one
- [ ] `npm run pack` regenerated `save-link-to-notion.zip`
- [ ] Screenshots still match the UI. Regenerate with
      `npm run build && node scripts/screenshots/capture.mjs`; upload the
      `docs/screenshots/*-1280x800.png` files (Save tab, Saved list, AI approval
      card, Options with detected column mapping).
- [ ] Privacy policy URL still resolves
