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
| `pronounce.js` | `PRON` - pronunciation practice: microphone capture, Azure Pronunciation Assessment, and the coach prompt. The parsing half is pure, so it is unit tested outside the browser |
| `ui.js` | `UI` - shared DOM rendering: stat tiles, streak/goal banner, add form, toast, item cards, grouped-by-day lists, pronunciation panel |
| `popup.html` / `popup.js` | Toolbar popup: add form, streak/goal banner, tabs, stats, item list, link to the full page |
| `app.html` / `app.js` | Full page: same as popup plus calendar, the settings panel (OpenAI key, daily goal, Azure key and region), and the pronunciation panel on every card |
| `style.css` | All styles, shared by popup and app page |
| `icons/` | Toolbar icons (16/48/128) |
| `scripts/chrome-devtools-mcp-wrapper.cjs` | Dev-only: see section 3, End-to-end testing |

Storage is one `chrome.storage.local` key `items` (array) and one key
`settings` (`{ apiKey, dailyGoal, azureKey, azureRegion }`). `lib.js` serializes all writes through
a single promise queue (`mutate`) so concurrent saves never clobber each
other - keep using `mutate`/`updateItem`/`deleteItem` for any new write path
instead of calling `chrome.storage.local.set` directly.

## 3. End-to-end testing

**Follow this section as written. Do not invent your own setup.**
Do not build a harness page, do not start a static file server, do not stub
`chrome.storage`. Those skip the real extension and cost more time than the
flow below. The one call in "Start" launches a real Chrome with this
extension loaded, and every later call reuses it.

### Cost rules (verified, follow them)

- **One browser per task.** Run "Start" once. Run `chrome-devtools-axi stop`
  once, at the very end of the whole task. Never stop between steps - a
  relaunch is the single most expensive thing in this flow.
- **Env vars go on the first call only.** Once the bridge is up, later
  `chrome-devtools-axi` calls need no env vars at all.
- **After editing `style.css`, `ui.js`, `lib.js`, `app.js` or `popup.js`,
  reload the tab, nothing else:**
  `chrome-devtools-axi eval "() => { location.reload(); return 1 }"`.
  The page refetches those files, so the edit is live. No extension reload,
  no relaunch.
- **Only `manifest.json` and `background.js` need an extension reload**,
  because they run in the service worker, not the page.
- **Reuse the open tab.** `open` the same URL again only if you navigated
  away.
- **Seed with one `eval`**, not fixture files (see "Seed data" below).

### Start (one call, once per task)

```
CFT="$(ls -d ~/.cache/puppeteer/chrome/*/*/*.app/Contents/MacOS/*Testing* | head -1)"
CHROME_DEVTOOLS_AXI_HEADED=1 \
CHROME_DEVTOOLS_AXI_EXECUTABLE_PATH="$CFT" \
CHROME_DEVTOOLS_AXI_USER_DATA_DIR=/tmp/english-learner-chrome-profile \
CHROME_DEVTOOLS_AXI_MCP_PATH="$(pwd)/scripts/chrome-devtools-mcp-wrapper.cjs" \
CHROME_DEVTOOLS_AXI_CHROME_ARGS="--load-extension=$(pwd)" \
npx -y chrome-devtools-axi pages
```

Then open the page and work there:

```
npx -y chrome-devtools-axi open chrome-extension://allphpomdcegopfeljgoonigidfiglde/app.html
```

The extension ID is a deterministic hash of this folder's absolute path, so
it stays the same as long as the checkout does not move. The popup is at
`.../popup.html`. If the path differs (different machine, moved checkout),
look the ID up instead of assuming:
```
python3 -c "
import json
d = json.load(open('/tmp/english-learner-chrome-profile/Default/Secure Preferences'))
for k, v in d.get('extensions', {}).get('settings', {}).items():
    if v.get('path') == '$(pwd)':
        print(k)
"
```

Two failures with known fixes:
- `No page is currently selected` on the first `open` after a fresh launch:
  run `npx -y chrome-devtools-axi selectpage 1` once and retry. One-time
  quirk of the initial `about:blank` tab.
- `BRIDGE_NOT_READY` / "CDP target appears to have gone away": a bridge from
  an earlier task is stale. `npx -y chrome-devtools-axi stop`, and if that
  is not enough, `kill` the node process on port 9224
  (`lsof -nP -iTCP:9224 -sTCP:LISTEN`), then start again.

### Why a separate Chrome for Testing build, and not the user's own Chrome

The user's own Chrome already has this extension installed, and attaching to
it instead of launching a new browser would be cheaper. It is not the
default for two reasons:

1. **It would destroy real data.** The seed step below overwrites the
   `items` key, which is the user's actual saved vocabulary. The
   `/tmp/english-learner-chrome-profile` profile is disposable; their daily
   profile is not. If you ever do attach to their Chrome, never seed - add
   with `LIB.addItem` and delete what you added.
2. **It needs a one-time manual toggle.** `CHROME_DEVTOOLS_AXI_AUTO_CONNECT=1`
   requires remote debugging enabled at `chrome://inspect/#remote-debugging`.
   As of 2026-10-28 it is **off** on this machine, so auto-connect fails.
   Only an unverified path until someone turns it on and confirms.

Two things also force the launch setup above, both verified against this
codebase:

- **Branded Google Chrome refuses `--load-extension` outright.** Since
  Chrome ~137 the official binary ignores `--load-extension` and
  `--disable-extensions-except` ("--load-extension is not allowed in Google
  Chrome, ignoring" - confirmed in the binary's strings). A **Chrome for
  Testing** build works. If `~/.cache/puppeteer/chrome/` is empty, fetch
  one: `npx -y @puppeteer/browsers install chrome@stable`.
- **chrome-devtools-axi needs `--categoryExtensions` on the underlying MCP
  server**, which has no axi env var. It is on by default only in
  chrome-devtools-mcp's own one-shot CLI mode, not when axi spawns it as an
  MCP server. The committed wrapper
  `scripts/chrome-devtools-mcp-wrapper.cjs` injects it, plus
  `--ignore-default-chrome-arg=--disable-extensions` (Puppeteer's default
  args disable extensions a second, independent way).

### Driving the microphone

**Follow this as written.** Two obvious-looking approaches both fail, and
both were paid for already.

Stub `getUserMedia` with a real `MediaStream` carrying a decoded wav. Chrome's
own fake-audio flags are the trap. Run this once per page load, before the
first attempt:

```
W=$(base64 -i word.wav | tr -d '\n')
npx -y chrome-devtools-axi eval "async () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const bin = atob(\"$W\");
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(u8.buffer);
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 3;
    src.connect(gain).connect(dest);
    setTimeout(() => src.start(), 700);
    return dest.stream;
  };
  return 'mic stubbed';
}"
```

Everything downstream is real: the voice-activity detector, `MediaRecorder`,
the wav encoder, the live Azure call and the UI. Make a clip with
`say -o x.aiff "definition" && afconvert -f WAVE -d LEI16@16000 -c 1 x.aiff x.wav`.

Three details that are not optional:

- **Start the audio ~700ms late.** The detector learns the room's noise floor
  from its first few frames. A stream that is already loud becomes the floor
  itself, the threshold goes up with it, and speech is never detected.
- **Gain it up (~3x).** A quiet stream sits under `VAD_RMS` and reads as
  silence.
- **Re-install it after every `location.reload()`.** It lives on `window`.

**Do not use `--use-file-for-fake-audio-capture`.** It looks like the right
tool and is not: the file plays **once** per Chrome session rather than
looping, and Chrome attenuates it to roughly a tenth of its real level. The
first attempt catches a clipped fragment and every later one records silence,
so a correctly pronounced word scores ~6% and the IPA comes back as nonsense.
Hours went into that number before it turned out to be the rig. Verified on
2026-10-28, Chrome for Testing 131.

**Do not reach for the real microphone either.** It is silent in this setup
and there is no way to feed it.

**Pass the anti-throttling flags when launching Chrome yourself.** Chrome
throttles `setInterval` to once a second as soon as its window falls behind
another, and the detector's 50ms loop silently becomes a 1s loop: the noise
floor is then measured over six seconds instead of 300ms, with the user's own
voice inside it. The suite failed in a different place on every run depending
on where the window happened to be. Puppeteer passes these by default, so
only hand-rolled launches need them:

```
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--disable-features=CalculateNativeWinOcclusion
```

When an attempt fails and the reason is not obvious, the suite wraps
`PRON.createSession` and reports the session's own timeline - states, ticks
and the final result - in the failure message. Read that before forming a
theory; four plausible theories died against it.

To check the encoder alone, without the microphone at all, hand a wav
straight to the real assessment call:

```
npx -y chrome-devtools-axi eval "async () => {
  const bin = atob(\"$W\"); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const r = await PRON.azureAssess('definition', 'word', new Blob([u8], { type: 'audio/wav' }));
  return r.score + ' ' + r.targetIpa;
}"
```

A clean `say "definition"` clip scores 96 this way. Anything far below that
means the recording is wrong, not the pronunciation.

### Seed data

One `eval`, straight into the real storage the extension reads:

```
npx -y chrome-devtools-axi eval "async () => { const items = [...]; await chrome.storage.local.set({ items }); return items.length }"
```

Each item needs `id, type, text, meaning, phonetic, audio, example,
examples, note, date, createdAt`. Use `LIB.todayStr()` for `date` so the
items land under today in the calendar and the stats tiles.

**Known limitation**: `chrome.contextMenus` items are native OS UI. No
automation tool can click a native right-click menu item. Call the same code
the menu click calls instead - `LIB.addItem` / `LIB.enrichItem` are
available via `eval` on any extension page, so the real save logic still
runs end to end. Only the native click is skipped.

**Testing the AI and Azure paths with real keys, without typing them
anywhere:** copy `.env.example` to `.env` (gitignored) and fill in a real
`OPENAI_API_KEY`, `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
A browser extension cannot read `.env` itself - there is no filesystem or
env var access from extension code - so seed it into the running session's
storage from the shell instead, after an extension page is open:
```
source .env
npx -y chrome-devtools-axi eval "async () => { const s = await chrome.storage.local.get('settings'); const settings = s.settings || {}; settings.apiKey = '$OPENAI_API_KEY'; settings.azureKey = '$AZURE_SPEECH_KEY'; settings.azureRegion = '$AZURE_SPEECH_REGION'; await chrome.storage.local.set({ settings }); return 'seeded'; }"
```
The key never appears in a prompt, a transcript, or git. This is a dev
convenience only - it does not change how the shipped extension stores a
user's own key.

### Standard flow to test

1. **Save path** (works around the native menu limit)
   ```
   npx -y chrome-devtools-axi eval "async () => { const r = await LIB.addItem('ubiquitous'); await LIB.enrichItem(r.id); return chrome.storage.local.get('items'); }"
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
     audio playback cannot be verified by the tool, only that it fired
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

4. **Pronunciation** - see "Driving the microphone" above. Never click
   **Start speaking** against the machine's real microphone and expect a
   score; there is nothing to hear.

5. **Regression check** - after any code change, re-run steps 1-4 before
   calling the change done. If an unrelated visual issue shows up on the way
   (misaligned card, wrong count, truncated text), fix it in the same pass.

Screenshot the popup and the full page after any UI-affecting change
(`npx -y chrome-devtools-axi screenshot <path>`) and look at it with the
Read tool. Do not just trust that the DOM rendered. Check the popup at its
real width (`resize 420 700`, `body.popup` is 380px) as well as the full
page - the card layout differs between them.

When the whole task is done, and only then:
`npx -y chrome-devtools-axi stop`.

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
- After changing `manifest.json` or `background.js`, reload the extension
  before testing - stale service workers hide real bugs. For every other
  file a tab reload is enough (see section 3, Cost rules).
- **Azure is the only pronunciation grader.** Do not add a speech-to-text
  fallback: a transcript cannot prove the sounds were right, because its
  language model corrects a mispronounced word back into the real one. A
  grader that cannot fail an attempt is worse than no grader. If Azure is
  unavailable, say so - never fill the gap with a made-up score.
- Four settings in `PRON.assessConfig` are load-bearing, so change them only
  on purpose: `PhonemeAlphabet: 'IPA'` (the default SAPI spells "tion" as
  "shaxn", which means nothing to a learner), `NBestPhonemeCount` (what the
  learner actually said, not just whether it was right),
  `EnableProsodyAssessment` (stress and rhythm), and `EnableMiscue`, which is
  on for sentences and **off** for single words - on a word it scores a
  learner who simply says it twice near zero.
- Recording clocks come from `PRON.limitsFor(targetText)`, never from the
  bare constants. A learner reading a sentence is slow and pauses between
  phrases, so both the hard cap and the end-of-speech pause scale with word
  count; the single-word values would cut them off mid-sentence.
- Pronunciation sources must agree on one accent. `lookupWord` picks the
  American transcription and its matching `-us.mp3` together, because Azure
  scores `en-US`. Taking the bare `phonetic` field instead gives the British
  one, which contradicts both the audio and the scoring.
- IPA reaches the screen through `LIB.readableIpa`, which swaps the strict
  symbols `ɹ` and `ɡ` for the `r` and `g` every learner dictionary prints. It
  is display only - stored text and anything sent to Azure stay strict. Add
  new IPA render paths through it, or the two lines of a comparison will
  spell the same sound differently.
- Never commit a real OpenAI API key or Azure Speech key. Settings are stored in
  `chrome.storage.local`, local to the browser, and must stay that way -
  don't add any remote sync or server-side storage without asking first.
- Keep `README.md`'s install/use instructions in sync with any UI or flow
  change - it's the only user-facing doc.
