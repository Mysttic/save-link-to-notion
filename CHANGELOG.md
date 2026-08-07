# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version here is
the one in `public/manifest.json` — the release workflow refuses to publish if
the two disagree.

## [Unreleased]

## [1.1.0] - 2026-08-07

A reliability and privacy pass over the whole extension, plus the features it
was missing next to other web clippers.

### Added

- Save without opening the popup: right-click entries for the page, a link or
  the selected text, and a `Ctrl+Shift+D` shortcut. `Ctrl+Shift+S` opens the
  popup.
- **Clip full article** — optionally store the readable body of the page on the
  Notion page as real blocks (headings, paragraphs, lists, quotes, code, images).
- Tag picker offering the multi-select options that already exist in the
  database, plus tags you type yourself.
- **AI summarize** — fills the note and suggests tags from the page.
- Server-side search in the Saved tab, across the whole database rather than the
  rows already loaded.
- **Create a database** from the options page, with the schema the extension
  expects, and **Test connection**, which shows which column was mapped to which
  role.
- Copy-link button on saved entries.
- Badge on the toolbar icon showing saves waiting to sync, and a confirmation
  flash after a quick save.

### Changed

- Column names are discovered from the live database instead of being
  hardcoded, so a database whose title column is Notion's default `Name` now
  works. Missing optional columns are skipped instead of failing the save.
- Notion errors are translated into messages that say what to do — an invalid
  key, a database that was never shared with the integration, and a rejected
  value no longer look the same.
- The offline queue only holds failures that can succeed later, gives up after
  five attempts, deduplicates on retry, and records anything it drops.
- Page content now reaches the AI as clearly marked untrusted data, and any
  write to Notion the assistant asks for has to be approved by you first.
- The popup was split into components and hooks, with a typed message protocol
  between popup, options page and service worker.

### Fixed

- Selected text was collected and displayed but never written to the
  **Highlights** column.
- A failed duplicate check was reported as "not saved yet", so a transient error
  silently produced a second row for the same URL.
- Two independent writers to the offline queue could overwrite each other, losing
  a queued save.
- Permanent failures such as a malformed request were retried every two minutes
  forever.
- Search in the Saved tab only looked at the 25 rows that happened to be loaded.
- Long notes and long articles broke the save: rich text over 2000 characters,
  more than 100 blocks per request, and payloads over 500KB are now split, and a
  batch Notion rejects is retried block by block so one bad block cannot discard
  the rest.
- URLs longer than 2000 characters were rejected by Notion; they are now clamped
  identically on write and on lookup, so duplicate detection still matches.
- A tag containing a comma made Notion reject the entire save.

### Security

- Dropped the `<all_urls>` host permission and the content script that ran on
  every page. The extension now asks for `activeTab`, `storage`, `scripting`,
  `alarms`, `contextMenus` and `favicon`, plus two specific API hosts.
- Fixed the Notion host permission pattern, which matched nothing and only
  worked because `<all_urls>` covered it, and declared `openrouter.ai`.
- Added an explicit content security policy for extension pages.
- Stopped logging API key fragments and raw Notion responses to the console.
- Site icons come from the browser's own favicon cache instead of Google's
  favicon service, which used to reveal the domains of every saved link.

### Removed

- The unused content script, and the `@notionhq/client`, `postcss` and
  `autoprefixer` dependencies, none of which were imported.

## [1.0.0] - 2026-03-23

First release.

- Save the current page's title, URL, description and a note to a Notion
  database, or update the existing row when the URL was already saved.
- Ask an AI assistant about the page through OpenRouter, and let it add images
  or generated text to the saved Notion page.
- Options page for the Notion API key and database ID, and an optional AI
  provider key and model.
- Saved links list with pagination and a cached first page.
- Offline queue retrying saves that failed while the network was down.
