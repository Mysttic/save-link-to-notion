# Save Link to Notion

A Chrome/Brave extension that lets you save links, notes, and chat with AI about the current page directly into your Notion database.

## Features

- **Save Link** – Save the current page URL, title, description, and optional note to a Notion database. Optionally update an existing page if the URL was already saved.
- **Ask AI** – Chat with an AI assistant (via OpenRouter) in the context of the current page. The agent can add images or generated text to the saved Notion page when you ask it to.
- **Settings** – Configure your Notion API key, Database ID, and optional OpenRouter API key and model in the extension options.

## Screenshot

![Extension popup – Save Link and Ask AI tabs](docs/popup-screenshot.png)

*Popup: Save Link tab with page title, URL, optional note, and Save to Database button.*

## Installation

### From Chrome Web Store (when published)

1. Open the extension page in the [Chrome Web Store](https://chrome.google.com/webstore) (link will be added after publication).
2. Click **Add to Chrome**.

### Manual installation (developer mode)

1. Clone the [repository](https://github.com/Mysttic/save-link-to-notion) and install dependencies:
   ```bash
   npm install
   npm run build
   ```
2. Open `chrome://extensions/` in Chrome or Brave.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project **`dist`** folder.

## Development

- **Run in dev mode:** `npm run dev`, then load the `dist` folder in `chrome://extensions/` (refresh after changes).
- **Build:** `npm run build`
- **Package for Chrome Web Store:** `npm run pack` – creates `save-link-to-notion.zip` for upload in the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Notion Setup

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations) and click **New integration**.
2. Give it a name (e.g. *Save Link to Notio*), select your workspace, and click **Save**.
3. Copy the **Internal Integration Token** (starts with `ntn_...`) — this is your **Notion API Key**.

### 2. Share your database with the integration

1. Open your Notion database page.
2. Click the **⋯** menu (top right) → **Connections** → find your integration and click **Connect**.

> Without this step the extension will get a `403 Unauthorized` error.

### 3. Find the Database ID

The Database ID is the part of the URL between the last `/` and the `?`:

```
https://www.notion.so/yourworkspace/317c38xxxxxxxxxxxxxxxxxxxxxxxx?v=...
                                    ↑ this is the Database ID (32 chars)
```

Paste this ID into the extension's **Options** page.

---

### 4. Required database structure

The extension expects the following **property names and types** in your Notion database. Property names are case-sensitive.

| Property name | Type | Required | Description |
|---|---|:---:|---|
| `Title` | Title (default) | ✅ | Page title |
| `Link` | URL | ✅ | Page URL — also used to detect if a page was already saved |
| `Description` | Text | ☐ | Page meta description or your note |
| `Tags` | Multi-select | ☐ | Populated from the page's `og:type` meta tag |
| `Highlights` | Text | ☐ | Selected text from the page |
| `Session ID` | Text | ☐ | Internal identifier (optional, can be hidden) |

> **Only `Title` and `Link` are strictly required.** The remaining properties are sent only when data is available — if a property is missing from your database it will simply be skipped without causing an error.

#### Quick setup (copy-paste template)

You can duplicate this example database into your workspace:  
Create a new database and add the following properties:

| Property | Notion type |
|---|---|
| Title | Title |
| Link | URL |
| Description | Text |
| Tags | Multi-select |
| Highlights | Text |
| Session ID | Text |

---

## Privacy

The extension stores data locally (API keys, Notion database ID) and sends it only to Notion and, optionally, to your chosen AI provider (e.g. OpenRouter). It does not collect or send data to the developers’ servers. See **[PRIVACY.md](PRIVACY.md)** for details.

## License

MIT (see LICENSE file if present).
