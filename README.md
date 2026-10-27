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
- Calendar with a count for each day, plus totals for today and for all time
- A streak counter and a daily goal bar, so you can see progress build up
- A short toast when you save an item, with a bigger one at streak milestones

## Add your API key (for sentences)

1. Open the full page.
2. Click **Settings**.
3. Paste your OpenAI API key, set your daily goal, and click **Save**.

If a word is not in the dictionary, the key also lets AI fill the meaning.

## Files

- `manifest.json`: extension settings
- `background.js`: right click menu and saving
- `lib.js`: storage and lookups
- `ui.js`: shared screen parts
- `popup.html`, `popup.js`: small popup
- `app.html`, `app.js`: full page with calendar and settings
- `style.css`: styles

## Notes

- Your data stays in your browser (`chrome.storage.local`).
- After you change any file, click the reload icon on `chrome://extensions`.
