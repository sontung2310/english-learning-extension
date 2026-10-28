# English Learner (Chrome extension)

Save English words and sentences with a right click. Track what you learn every day.

## Install

1. Unzip the folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `english-learner` folder.
5. Pin the extension (puzzle icon in the toolbar).

## Use

1. Select a word or sentence on any web page.
2. Right click and choose **Save "..." to English Learner**.
3. Or type a word or sentence straight into the box at the top of the popup
   or full page and press Enter - no selection needed.
4. Click the extension icon to see your list. Click **Open full page** for
   the calendar.

One word goes to the **Words** tab. More than one word (a sentence, or
just a chunk of words) goes to the **Sentences** tab.

## What you get

- Words: meaning, pronunciation, example (free dictionary: dictionaryapi.dev)
- Sentences: meaning in simple English and one example (needs an OpenAI API key)
- Speaker button to hear any word or sentence
- "+ More examples" to get another example sentence any time (needs an OpenAI API key)
- "Ask a question" chat on each card, for follow-up questions about that word or sentence (needs an OpenAI API key)
- "Pronunciation" practice (full page only): say the word out loud and see
  which syllables matched, with a score and coaching on what to fix
- Calendar with a count for each day, plus totals for today and for all time
- A streak counter and a daily goal bar, so you can see progress build up
- A short toast when you save an item, with a bigger one at streak milestones

## Add your API key (for sentences)

1. Open the full page.
2. Click **Settings**.
3. Paste your OpenAI API key, set your daily goal, and click **Save**.

If a word is not in the dictionary, the key also lets AI fill the meaning.
It also writes the one-line coaching tip under each pronunciation score.

For pronunciation scoring you also need an **Azure Speech** key and region
(the free tier is enough). Paste both into the same Settings panel. Without
them the practice panel says so instead of inventing a score.

## Files

- `manifest.json`: extension settings
- `background.js`: right click menu and saving
- `lib.js`: storage and lookups
- `pronounce.js`: pronunciation practice (microphone, Azure scoring, coaching)
- `ui.js`: shared screen parts
- `popup.html`, `popup.js`: small popup
- `app.html`, `app.js`: full page with calendar and settings
- `style.css`: styles

## Pronunciation practice

Open the full page and press **Start speaking** on any card. Your recording is
scored by Azure Pronunciation Assessment, which judges the actual sounds you
made against the word. Speech-to-text cannot do this job: its language model
quietly corrects a mispronounced word back into the real one, so a wrong
attempt would still score full marks.

**A single word** shows two lines of IPA:

```
TARGET    /ˌdef.ɪˈnɪʃ.ən/     what the word should sound like
YOU SAID  /bənæn/             what actually came out
```

Every sound is coloured on its own: green if you made it, red if you did not.
Hover a red sound to see which sound belonged there and how it scored. Below
that, the word is split into syllables, also coloured, so you can see which
part to practise.

The target line comes from the free dictionary when it has the word, because
its IPA carries stress marks. For anything the dictionary does not know, Azure's
own reference sounds stand in.

**A sentence** is marked the way a PTE Speaking examiner marks a read-aloud:

| Row | What it measures |
|---|---|
| Content | how much of the sentence you actually said |
| Pronunciation | the sounds inside each word |
| Fluency | pace and pauses |
| Prosody | rhythm and stress |

Under the bars, every word is coloured by its own score, with skipped and
inserted words called out. Tap any word to open its own IPA comparison.

## Tests

- `node pronounce.test.js` - parsing of Azure's reply, on responses captured
  from the live service. No setup needed.
- `node pronounce.e2e.mjs` - drives the real extension page in a real browser.
  Needs Chrome for Testing: `npx -y @puppeteer/browsers install chrome@stable`.
  The microphone is a real audio stream and Azure's HTTP reply is a captured
  one, so every run is repeatable and costs no API calls.

## Notes

- Your data stays in your browser (`chrome.storage.local`).
- After you change any file, click the reload icon on `chrome://extensions`.
- Pronunciation practice is on the full page only. The popup closes whenever
  it loses focus, which would cancel the microphone prompt mid-recording.
