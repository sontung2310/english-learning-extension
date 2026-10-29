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
| `scripts/chrome-devtools-mcp-wrapper.cjs` | Dev-only: see the `e2e-testing` skill |

Storage is one `chrome.storage.local` key `items` (array) and one key
`settings` (`{ apiKey, dailyGoal, azureKey, azureRegion }`). `lib.js` serializes all writes through
a single promise queue (`mutate`) so concurrent saves never clobber each
other - keep using `mutate`/`updateItem`/`deleteItem` for any new write path
instead of calling `chrome.storage.local.set` directly.
## 3. Testing

Run the **`e2e-testing` skill** before any browser testing, before verifying a
change in the real extension, and before committing. It holds the launch
recipe, the microphone setup, and the traps that have already cost hours -
including several that look like bugs in the code and are not.

Pick the cheapest test that can answer the question. Most changes never need
a browser:

| Command | Time | Answers |
|---|---|---|
| `node pronounce.test.js` | 0.04s | anything pure: parsing Azure's reply, IPA assembly, scoring bands, timing limits, the coach briefing |
| `node pronounce.e2e.mjs --only=<block>` | 4-12s | one scenario in a real browser |
| `node pronounce.e2e.mjs --bail` | stops at first failure | "did I break it?" while iterating |
| `node pronounce.e2e.mjs` | ~78s | the regression check, before calling a change done |

A change to pure logic is covered by `pronounce.test.js` alone. A change to
rendering, storage, the microphone or the manifest needs the browser. The
popup, calendar and settings flows have **no automated coverage at all** -
they are still a manual click-through, described in the skill.

**Do not improvise an alternative setup.** If the documented path is wrong or
missing something, fix the skill in the same pass.

## 4. Project conventions

**Code**
- No build step, bundler, TypeScript or framework. Plain JS.
- Logic in `lib.js` (`LIB`), rendering in `ui.js` (`UI`). `background.js`,
  `popup.js` and `app.js` only wire events to them.
- Every storage write goes through `LIB.mutate`/`updateItem`/`deleteItem` -
  that is what stops concurrent saves racing.
- 2-space indent, arrow functions, comments only where the WHY is non-obvious.
- Reload the extension after `manifest.json` or `background.js`; stale service
  workers hide real bugs. A tab reload covers every other file.

**Pronunciation** - decisions, not accidents:
- Azure is the only grader. Never add a speech-to-text fallback: a transcript
  cannot fail a mispronounced word, because the recogniser corrects it. If
  Azure is unavailable, say so - never invent a score.
- In `PRON.assessConfig` keep `PhonemeAlphabet: 'IPA'` (SAPI spells "tion" as
  "shaxn"), `NBestPhonemeCount` (what was actually said) and
  `EnableProsodyAssessment`. `EnableMiscue` is on for sentences, **off** for
  words - on a word it near-zeroes a learner who says it twice.
- Recording clocks come from `PRON.limitsFor(target)`, never the bare
  constants: a sentence needs longer than a word on both clocks.
- One accent. `lookupWord` takes the American transcription with its matching
  `-us.mp3`, because Azure scores `en-US`.
- IPA renders through `LIB.readableIpa` (`ɹ`→`r`, `ɡ`→`g`) - display only,
  stored and Azure-bound text stay strict.

**Content, data and docs**
- A word's meaning always opens with its part of speech: `(noun) any variety
  of vinegar`. Dictionary and AI paths both go through `LIB.withPos`.
  Sentences have none.
- Never commit a real OpenAI or Azure key. Settings live in
  `chrome.storage.local` and stay there - no remote sync without asking.
- Keep `README.md` in sync with any UI or flow change; it is the only
  user-facing doc.
