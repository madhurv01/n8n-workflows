
<img
    src="WebScrappingAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />

# Web Scrapper — n8n Workflow

**Platform:** n8n (self-hosted / cloud) &nbsp;|&nbsp; **Trigger:** Form Submission &nbsp;|&nbsp; **Destination:** Google Sheets &nbsp;|&nbsp; **Nodes:** 9

A web scraping automation. A user submits a URL through an n8n form, the workflow fetches that page's raw HTML, extracts every hyperlink (`<a href>`) and image (`<img src>`), normalizes/de-duplicates them, converts them into Google Sheets formulas, and appends the results as rows in a connected Google Sheet.


> The workflow contains a hardcoded base-URL assumption for **Pinterest** (`https://www.pinterest.com`) used to resolve relative links. The HTTP fetch and HTML extraction logic works generically on any URL, but relative links will only resolve correctly for Pinterest unless this is changed.

---

## 1. Overview

**Useful for:**
- Quickly collecting every outbound link and image URL from a single web page.
- Building a running spreadsheet log of scraped links/images for later review (content curation, competitor research, mood-boarding from Pinterest).
- A reusable base template that can be adapted to other sites by changing the base-URL logic.

---

## 2. Workflow Architecture

The 9 nodes execute strictly in sequence — there is no branching or conditional logic.

```
1. On form submission     → captures the URL typed into the form
2. Code in JavaScript     → pulls the URL field out of the form payload
3. HTTP Request           → fetches the raw HTML of that URL
4. HTML                   → extracts all <a href> links and <img src> images
5. Code in JavaScript1    → resolves relative links to absolute Pinterest URLs + de-duplicates
6. Code in JavaScript2    → flattens links/images arrays into individual typed items
7. Code in JavaScript4    → re-splits items back into two arrays, zips into link/image row pairs
8. Code in JavaScript3    → wraps each row in Google Sheets HYPERLINK() and IMAGE() formulas
9. Append or update row   → writes/updates rows in the Google Sheet
```

---

## 3. Node-by-Node Breakdown

### 1 — On form submission
**Type:** Form Trigger (`n8n-nodes-base.formTrigger`)
**Purpose:** Entry point. Renders a public n8n form titled "Web Scrapper" with a single text field, `URL`. Submitting the form starts the workflow run.
**Config:** Form Title: "Web Scrapper" · Field: `URL` (text input) · typeVersion: 2.5

### 2 — Code in JavaScript
**Type:** Code (`n8n-nodes-base.code`)
**Purpose:** Reads the submitted form data, extracts just the `URL` value, logs it, and passes it downstream as `{ url }`.
```js
const items = $input.all();
const url = items[0].json.URL;
console.log(url);
return [ { json: { url } } ];
```

### 3 — HTTP Request
**Type:** HTTP Request (`n8n-nodes-base.httpRequest`)
**Purpose:** Performs a GET request to the submitted URL and retrieves the page's raw HTML.
**Config:** URL = `{{$json.url}}` (expression bound to previous node) · default GET method

### 4 — HTML
**Type:** HTML Extract (`n8n-nodes-base.html`, operation: `extractHtmlContent`)
**Purpose:** Parses the fetched HTML and extracts two arrays via CSS selectors.
**Config:**
- Extraction 1 — key: `links` | selector: `a` | attribute: `href` | returns array
- Extraction 2 — key: `images` | selector: `img` | attribute: `src` | returns array

### 5 — Code in JavaScript1
**Type:** Code
**Purpose:** Converts relative paths into absolute URLs using a hardcoded Pinterest base URL, then de-duplicates links and images.
```js
const baseUrl = "https://www.pinterest.com";

const links = ($json.links || []).map(link => {
  if (!link) return null;
  if (link.startsWith("http")) return link;
  if (link.startsWith("/")) return baseUrl + link;
  return baseUrl + "/" + link;
}).filter(Boolean);

const images = [...new Set($json.images || [])];

return [{ json: { links: [...new Set(links)], images } }];
```
> ⚠️ Base URL is hardcoded to Pinterest — scraping another domain still works for absolute links, but relative links resolve incorrectly.

### 6 — Code in JavaScript2
**Type:** Code
**Purpose:** Flattens the links/images arrays into individual n8n items, each tagged with `type: "link"` or `type: "image"`.
```js
const links = $json.links || [];
const images = $json.images || [];

return [
  ...links.map(link => ({ json: { type: "link", value: link } })),
  ...images.map(image => ({ json: { type: "image", value: image } }))
];
```

### 7 — Code in JavaScript4
**Type:** Code
**Purpose:** Re-separates items back into two lists by type, then zips them index-by-index into row objects `{ link, image }`.
```js
const items = $input.all();
const links = items.filter(i => i.json.type === "link").map(i => i.json.value);
const images = items.filter(i => i.json.type === "image").map(i => i.json.value);

const maxLen = Math.max(links.length, images.length);
const rows = [];
for (let i = 0; i < maxLen; i++) {
  rows.push({ json: { link: links[i] || "", image: images[i] || "" } });
}
return rows;
```
> Note: links and images are paired purely by array index, not by which link actually contains which image.

### 8 — Code in JavaScript3
**Type:** Code
**Purpose:** Wraps each row's plain URL strings in Google Sheets formula syntax so they render as clickable links / inline thumbnails.
```js
const items = $input.all();
return items.map(item => ({
  json: {
    link: `=HYPERLINK("${item.json.link}", "${item.json.link}")`,
    image: `=IMAGE("${item.json.image}")`
  }
}));
```

### 9 — Append or update row in sheet
**Type:** Google Sheets (`n8n-nodes-base.googleSheets`, operation: `appendOrUpdate`)
**Purpose:** Writes the final formula-wrapped rows into the connected Google Sheet.
**Config:**
- Spreadsheet: `WEB SCRAPPER`
- Sheet/tab: `Scrapped Data` (gid=0)
- Column mapping: `Links = {{$json.link}}`, `Images = {{$json.image}}`
- Matching column: `Links` (decides append vs. update)
- Credential: Google Sheets OAuth2

---

## 4. Example Data Flow

| Stage | Example Value |
|---|---|
| Form input | `URL = https://www.pinterest.com/search/pins/?q=travel` |
| After Code in JavaScript | `{ url: "https://www.pinterest.com/search/pins/?q=travel" }` |
| After HTTP Request | Raw HTML string of the page |
| After HTML node | `{ links: ["/pin/123", "https://ext.com/a"], images: ["/img1.jpg", "/img1.jpg"] }` |
| After Code in JavaScript1 | `{ links: ["https://www.pinterest.com/pin/123", "https://ext.com/a"], images: ["/img1.jpg"] }` |
| After Code in JavaScript2 | `{type: link, value: ...}, {type: link, value: ...}, {type: image, value: ...}` |
| After Code in JavaScript4 | `{ link: "https://www.pinterest.com/pin/123", image: "/img1.jpg" }` (+ 1 more row) |
| After Code in JavaScript3 | `{ link: '=HYPERLINK("...","...")', image: '=IMAGE("/img1.jpg")' }` |
| Final sheet row | Links column = clickable link · Images column = rendered thumbnail |

---

## 5. Step-by-Step Build Guide

1. **Create the trigger** — Add a **Form Trigger** node. Set the title to "Web Scrapper" and add one field labeled `URL`.
2. **Extract the submitted URL** — Add a **Code** node. Read `$input.all()[0].json.URL` and return `{ json: { url } }`.
3. **Fetch the page** — Add an **HTTP Request** node. Set URL to the expression `{{$json.url}}`.
4. **Extract links and images** — Add an **HTML** node, operation `Extract HTML Content`. Define extraction for `a` → `href` (array, key: `links`) and `img` → `src` (array, key: `images`).
5. **Normalize and de-duplicate** — Add a **Code** node to prefix relative links with the base URL and de-duplicate both arrays using `Set`.
6. **Flatten into individual items** — Add a **Code** node that maps links/images arrays into separate items with a `type` and `value` field.
7. **Re-pair links with images** — Add a **Code** node that filters items back into two arrays by type, then zips them by index into `{ link, image }` rows.
8. **Wrap as Sheets formulas** — Add a **Code** node that wraps each row's link in `HYPERLINK()` and each image URL in `IMAGE()`.
9. **Write to Google Sheets** — Add a **Google Sheets** node, operation `Append or Update Row`. Connect your credential, map `Links`/`Images` columns, set `Links` as the matching column.
10. **Wire connections and activate** — Connect nodes in the exact order above (trigger → code → HTTP → HTML → code1 → code2 → code4 → code3 → Google Sheets), save, and toggle the workflow **Active**.

---

## 6. Prerequisites & Setup

**Credentials required:** Google Sheets OAuth2 credential with edit access to the destination spreadsheet.

**Target spreadsheet structure:** A Google Sheet named `WEB SCRAPPER` with a tab `Scrapped Data` containing columns `Links` and `Images`.

**n8n environment:** Form Trigger v2.5, HTTP Request v4.4, HTML v1.2, Code v2, Google Sheets v4.7 (or newer compatible versions), plus outbound internet access.

---

## 7. Configuring the Google Sheets OAuth2 Credential

### Option A — Quick setup (n8n Cloud)
1. Open the "Append or update row in sheet" node.
2. Under **Credential to connect with**, click **Create New Credential**.
3. Choose **Google Sheets OAuth2 API**.
4. Click **Sign in with Google** and approve access using n8n's shared OAuth app.
5. Log in with the account that owns/has edit access to the target spreadsheet.
6. n8n stores the token as a reusable credential (e.g. "Google Sheets account").
7. Select the credential, then pick the `WEB SCRAPPER` spreadsheet and `Scrapped Data` sheet.

> Works only where n8n's shared Google OAuth app is enabled for your account/org.

### Option B — Manual setup (self-hosted / production)
1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Sheets API** and **Google Drive API**.
3. Configure the **OAuth consent screen** (app name, support email, developer contact).
4. Add scopes: `.../auth/spreadsheets` and `.../auth/drive.file`.
5. Add test users if the app is in Testing mode.
6. Go to **Credentials → Create Credentials → OAuth client ID**, type **Web application**.
7. In n8n, open the Google Sheets node → **Create New Credential** → **Google Sheets OAuth2 API**, and copy the displayed **OAuth Redirect URL**.
8. Paste that redirect URL into **Authorized redirect URIs** on the Google Cloud OAuth client, then save.
9. Copy the generated **Client ID** and **Client Secret** from Google Cloud Console.
10. Paste both into the n8n credential form, then **Sign in with Google** and approve access.
11. Once connected, n8n shows status **Connected**. Save and select the credential in the node.

### Sharing the spreadsheet
- Give the credential's Google account at least **Editor** access to the `WEB SCRAPPER` spreadsheet.
- For Shared Drives / different Workspace domains, confirm the OAuth scopes and domain access allow reach.

### Verifying the credential
- The node's spreadsheet dropdown should list `WEB SCRAPPER` without an auth error.
- Run the node once manually ("Execute step") with a test row before activating the full workflow.

---

## 8. Known Limitations

- **Hardcoded base URL:** relative links always resolve against `https://www.pinterest.com`.
- **Positional pairing:** link ↔ image pairing is by array index, not actual DOM relationship.
- **No pagination or JS rendering:** static HTML fetch only; client-rendered content is not captured.
- **No error handling:** no branch for failed requests, empty results, or invalid URLs.
- **No de-duplication against existing sheet rows:** de-dup only happens within a single run.

---

## 9. Suggested Improvements

- Dynamically derive the base URL from the submitted URL instead of hardcoding Pinterest.
- Add an **IF** / error-handling branch after the HTTP Request node.
- Pair images to links contextually instead of by array index.
- Add rate-limiting/wait nodes when scraping multiple pages in sequence.
- Use a headless-browser fetch (Puppeteer/Playwright) for JavaScript-rendered pages.

---

*Documentation based on analysis of the exported workflow file `Web_Scapper.json`.*