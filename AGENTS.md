# English Learner (Chrome extension)

## 1. What this project is

A Chrome extension (Manifest V3).
Select a word or sentence on any web page, right click, and save it - or
type one straight into the add box in the popup or full page.

- One word goes to the **Words** tab.
- More than one word (a sentence, or just a chunk of words) goes to the
  **Sentences** tab - `LIB.classify()` decides this from the text alone, so
  the manual add box and the right-click path share the same rule.
- Words are looked up on the free dictionary API (dictionaryapi.dev).
- Sentences (and words the dictionary cannot find) are explained by the
  OpenAI API, using the user's own API key stored in `chrome.storage.local`.
- A streak counter and a daily-goal progress bar encourage regular use; a
  toast confirms each save and calls out streak milestones.
- A popup shows today's stats and a short list.
- A full page (`app.html`) adds a calendar view and the settings panel for
  the OpenAI API key and the daily goal.
- All data stays local to the browser. There is no backend server.

## 2. Stack and layout

No build step, no framework, no bundler. Plain HTML/CSS/JS, loaded as an
unpacked extension.

| File | Role |
|---|---|
| `manifest.json` | MV3 config: permissions, background service worker, popup, icons |
| `background.js` | Context menu registration and click handler (the save entry point) |
| `lib.js` | `LIB` - all shared logic: storage, classify word vs sentence, dictionary lookup, OpenAI call, streak math, speech. Shared by background, popup, and app page |
| `ui.js` | `UI` - shared DOM rendering: stat tiles, streak/goal banner, add form, toast, item cards, grouped-by-day lists |
| `popup.html` / `popup.js` | Toolbar popup: add form, streak/goal banner, tabs, stats, item list, link to the full page |
| `app.html` / `app.js` | Full page: same as popup plus calendar and the settings panel (API key, daily goal) |
| `style.css` | All styles, shared by popup and app page |
| `icons/` | Toolbar icons (16/48/128) |
| `scripts/chrome-devtools-mcp-wrapper.cjs` | Dev-only: see section 3, End-to-end testing |

Storage is one `chrome.storage.local` key `items` (array) and one key
`settings` (`{ apiKey, dailyGoal }`). `lib.js` serializes all writes through
a single promise queue (`mutate`) so concurrent saves never clobber each
other - keep using `mutate`/`updateItem`/`deleteItem` for any new write path
instead of calling `chrome.storage.local.set` directly.

## 3. End-to-end testing

Use the `chrome-devtools-axi` skill to drive a real Chrome, loaded with this
extension unpacked, the same way a real user would. Two things need a
workaround, both verified against this codebase and documented below:

- **Branded Google Chrome refuses `--load-extension` outright.** Since
  Chrome ~137, the official "Google Chrome" binary ignores
  `--load-extension` and `--disable-extensions-except` on the command line
  ("--load-extension is not allowed in Google Chrome, ignoring" - confirmed
  by inspecting the binary's strings). You need an unbranded build. A
  **Chrome for Testing** build works. Check for one already cached:
  `ls ~/.cache/puppeteer/chrome/`. If missing, fetch one:
  `npx -y @puppeteer/browsers install chrome@stable` then point
  `CHROME_DEVTOOLS_AXI_EXECUTABLE_PATH` at the `.app/Contents/MacOS/Google
  Chrome for Testing` binary it installs (or the Linux/Windows equivalent).

- **chrome-devtools-axi needs `--categoryExtensions` on the underlying MCP
  server**, which has no axi env var. It's on by default only in
  chrome-devtools-mcp's own one-shot CLI mode, not when axi spawns it as an
  MCP server. Route through the committed wrapper,
  `scripts/chrome-devtools-mcp-wrapper.cjs`, via
  `CHROME_DEVTOOLS_AXI_MCP_PATH` - it injects `--categoryExtensions` and
  `--ignore-default-chrome-arg=--disable-extensions` (Puppeteer's own
  default args disable extensions a second, independent way).

**Known limitation**: `chrome.contextMenus` items are native OS UI. No
automation tool (chrome-devtools-axi, Puppeteer, or otherwise) can click a
native right-click menu item. Work around it by calling the exact same code
the menu click calls - `LIB.addItem` / `LIB.enrichItem` are available via
`eval` on any extension page (popup or app page both load `lib.js`), so this
still exercises the real save logic end to end. Only the native menu click
itself is stubbed out.

### Setup (one time per test session)

```
CFT="$(ls -d ~/.cache/puppeteer/chrome/*/*/*.app/Contents/MacOS/*Testing* | head -1)"
CHROME_DEVTOOLS_AXI_HEADED=1 \
CHROME_DEVTOOLS_AXI_EXECUTABLE_PATH="$CFT" \
CHROME_DEVTOOLS_AXI_USER_DATA_DIR=/tmp/english-learner-chrome-profile \
CHROME_DEVTOOLS_AXI_MCP_PATH="$(pwd)/scripts/chrome-devtools-mcp-wrapper.cjs" \
CHROME_DEVTOOLS_AXI_CHROME_ARGS="--load-extension=$(pwd)" \
chrome-devtools-axi pages
```

Keep those five env vars set for every subsequent `chrome-devtools-axi`
call in the session (the bridge launches once and is reused).

The extension ID is a deterministic hash of this folder's absolute path -
same ID every run as long as the checkout doesn't move. For the current
checkout it's `allphpomdcegopfeljgoonigidfiglde`, so the popup is at
`chrome-extension://allphpomdcegopfeljgoonigidfiglde/popup.html` and the
full page at `.../app.html`. If the path differs (different machine, moved
checkout), look it up instead of assuming:
```
python3 -c "
import json
d = json.load(open('/tmp/english-learner-chrome-profile/Default/Secure Preferences'))
for k, v in d.get('extensions', {}).get('settings', {}).items():
    if v.get('path') == '$(pwd)':
        print(k)
"
```
(`chrome-devtools-axi pages` must have run at least once first so Chrome
has actually started and written the profile.)

The very first `open`/`newpage` call after a fresh launch sometimes errors
"No page is currently selected" - run `chrome-devtools-axi selectpage 1`
once and retry; this is a one-time quirk of the initial `about:blank` tab.

**Testing the AI path with a real key, without typing it anywhere:** copy
`.env.example` to `.env` (gitignored) and fill in a real `OPENAI_API_KEY`.
A browser extension can't read `.env` itself - there's no filesystem or env
var access from extension code - so seed it into the running test
session's storage from the shell instead, after an extension page is open
and selected:
```
source .env
chrome-devtools-axi eval "async () => { const s = await chrome.storage.local.get('settings'); const settings = s.settings || {}; settings.apiKey = '$OPENAI_API_KEY'; await chrome.storage.local.set({ settings }); return 'seeded'; }"
```
The key never appears in a prompt, a chat transcript, or git. This is a
dev/test convenience only - it does not change how the shipped extension
stores a user's own key, which stays in `chrome.storage.local` via the
Settings panel (the only storage a browser extension has for a per-user
secret, with no backend to put it behind).

### Standard flow to test

1. **Save path (works around the native menu limit)**
   On any extension page (popup or app), run the same call `background.js`
   makes on a context-menu click:
   ```
   chrome-devtools-axi eval "async () => { const r = await LIB.addItem('ubiquitous'); await LIB.enrichItem(r.id); return chrome.storage.local.get('items'); }"
   ```
   Check `status` was `added` (or `duplicate` on a repeat) and that
   `meaning`/`example`/`phonetic` land in the stored item.

2. **Popup** - `open chrome-extension://<id>/popup.html`, then as a real
   user would:
   - Fill the add box with a single word, press Enter, confirm it lands in
     the **Words** tab; fill it with a multi-word phrase, confirm it lands
     in **Sentences** instead (`LIB.classify` draws the line).
   - Confirm the streak banner and the daily-goal bar update after a save,
     and a "Saved! +1" toast appears (`#ui-toast.show`).
   - Switch between the Words/Sentences tabs, confirm counts match storage.
   - Click the speaker icon on a card, confirm no console error (actual
     audio playback can't be verified by the tool, only that it fired
     without throwing).
   - Click delete, confirm the browser's `confirm()` dialog appears
     (`dialog accept`/`dialog dismiss`), and the card is removed on accept.
   - Click "Open full page", confirm a new tab opens to `app.html`.

3. **Full page** - `open chrome-extension://<id>/app.html`:
   - Confirm the calendar highlights today and shows the right per-day
     counts for seeded items.
   - Click a day cell, confirm the list filters to that day; click again to
     clear the filter.
   - Click the gear icon, paste a dummy OpenAI key and a daily-goal number
     into Settings, Save, reload the page, confirm both persisted and the
     goal bar reflects the new target.
   - Prev/next month buttons move the calendar and update the month total.

4. **Regression check** - after any code change, re-run steps 1-3 before
   calling the change done. If an unrelated visual issue shows up on the
   way (misaligned card, wrong count, truncated text), fix it in the same
   pass - don't leave it for later.

Take a screenshot (`chrome-devtools-axi screenshot <path>`) of the popup
and the full page after any UI-affecting change, and look at it with the
Read tool - don't just trust that the DOM rendered.

When done, stop the bridge: `chrome-devtools-axi stop`.

## 4. Project conventions

- No build step. Don't introduce a bundler, TypeScript, or a framework for
  this - the whole extension is ~650 lines across 5 files. Add plain JS.
- Keep shared logic in `lib.js` (`LIB`) and shared rendering in `ui.js`
  (`UI`). `background.js`, `popup.js`, `app.js` should stay thin - they wire
  events to `LIB`/`UI`, they don't duplicate logic.
- All storage writes go through `LIB.mutate`/`updateItem`/`deleteItem`
  (never a direct `chrome.storage.local.set({ items })`) - this is what
  keeps concurrent saves from racing.
- Match the existing code style: no semicolons omitted, 2-space indent,
  arrow functions, `const`/`let`, no comments except where the WHY is
  non-obvious (see `lib.js` for the pattern already in use).
- After any change, reload the extension on `chrome://extensions` (or
  relaunch via chrome-devtools-axi) before testing - stale service workers
  hide real bugs.
- Never commit a real OpenAI API key. Settings are stored in
  `chrome.storage.local`, local to the browser, and must stay that way -
  don't add any remote sync or server-side storage without asking first.
- Keep `README.md`'s install/use instructions in sync with any UI or flow
  change - it's the only user-facing doc.
