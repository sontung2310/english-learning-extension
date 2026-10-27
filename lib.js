// Shared helpers for the background worker, the popup and the full page.
const LIB = (() => {
  const MODEL = 'gpt-4o-mini';
  const DEFAULT_GOAL = 5;
  const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dateStr(new Date());

  // ---------- storage ----------
  async function getItems() {
    const { items = [] } = await chrome.storage.local.get('items');
    return items;
  }

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    return settings;
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  }

  // Run changes one by one so two writes never overwrite each other.
  let queue = Promise.resolve();
  function mutate(fn) {
    const run = queue.then(async () => {
      const items = await getItems();
      const next = (await fn(items)) || items;
      await chrome.storage.local.set({ items: next });
    });
    queue = run.catch(() => {});
    return run;
  }

  const updateItem = (id, patch) =>
    mutate((items) => {
      const item = items.find((i) => i.id === id);
      if (item) Object.assign(item, patch);
    });

  const deleteItem = (id) => mutate((items) => items.filter((i) => i.id !== id));

  // ---------- word or sentence ----------
  function classify(raw) {
    const text = (raw || '').replace(/\s+/g, ' ').trim();
    const stripped = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!stripped) return null;
    if (/^\p{L}[\p{L}'’-]*$/u.test(stripped)) {
      return { type: 'word', text: stripped.toLowerCase() };
    }
    return { type: 'sentence', text };
  }

  async function addItem(raw) {
    const c = classify(raw);
    if (!c) return { status: 'empty' };
    let id = null;
    let duplicate = false;
    await mutate((items) => {
      const key = c.text.toLowerCase();
      if (items.some((i) => i.type === c.type && i.text.toLowerCase() === key)) {
        duplicate = true;
        return;
      }
      id = crypto.randomUUID();
      items.push({
        id,
        type: c.type,
        text: c.text,
        meaning: '',
        phonetic: '',
        audio: '',
        example: '',
        note: 'Looking up...',
        date: todayStr(),
        createdAt: Date.now(),
      });
    });
    return duplicate ? { status: 'duplicate' } : { status: 'added', id };
  }

  // ---------- lookups ----------
  async function lookupWord(word) {
    const res = await fetch(
      'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word)
    );
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return null;

    const phonetics = entry.phonetics || [];
    const phonetic = entry.phonetic || (phonetics.find((p) => p.text) || {}).text || '';
    let audio = (phonetics.find((p) => p.audio) || {}).audio || '';
    if (audio.startsWith('//')) audio = 'https:' + audio;

    const defs = [];
    for (const m of entry.meanings || []) {
      for (const d of m.definitions || []) defs.push({ pos: m.partOfSpeech, ...d });
    }
    // Prefer a definition that has an example, so meaning and example match.
    const best = defs.find((d) => d.example) || defs[0];
    if (!best) return null;
    const meaning = best.pos ? `(${best.pos}) ${best.definition}` : best.definition;
    return { meaning, example: best.example || '', phonetic, audio };
  }

  async function askOpenAI(apiKey, text, type) {
    const prompt =
      type === 'word'
        ? `Explain the English word "${text}" for a learner with basic English. Reply with JSON only, no other text: {"meaning":"simple meaning in one short sentence","example":"one short example sentence"}`
        : `Explain this English sentence for a learner with basic English. Reply with JSON only, no other text: {"meaning":"what it means, in simple English, 1 or 2 short sentences","example":"one other short example that uses a similar idea or phrase"}\n\nSentence: ${text}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || `HTTP ${res.status}`);
    }
    const json = await res.json();
    const reply = (json.choices && json.choices[0] && json.choices[0].message.content) || '';
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Bad reply from AI');
    return JSON.parse(match[0]);
  }

  // Fill meaning, pronunciation and example for one saved item.
  async function enrichItem(id) {
    const item = (await getItems()).find((i) => i.id === id);
    if (!item) return;
    await updateItem(id, { note: 'Looking up...' });

    const info = { meaning: '', phonetic: '', audio: '', example: '' };
    let note = '';

    if (item.type === 'word') {
      try {
        Object.assign(info, (await lookupWord(item.text)) || {});
      } catch (e) {
        // dictionary not reachable, try AI below
      }
    }

    if (!info.meaning || !info.example) {
      const { apiKey } = await getSettings();
      if (apiKey) {
        try {
          const ai = await askOpenAI(apiKey, item.text, item.type);
          info.meaning = info.meaning || ai.meaning || '';
          info.example = info.example || ai.example || '';
        } catch (e) {
          note = 'AI lookup failed: ' + e.message;
        }
      } else if (!info.meaning) {
        note =
          item.type === 'sentence'
            ? 'Add your OpenAI API key in Settings to get the meaning.'
            : 'Word not found in the dictionary. Add an API key in Settings for AI help.';
      }
    }

    await updateItem(id, { ...info, note });
  }

  // ---------- streak ----------
  // Consecutive days with at least one item, counted back from today.
  // Stays alive through "today" even before anything is saved today, so the
  // streak only breaks once a full day passes with nothing added.
  function computeStreak(items) {
    const days = new Set(items.map((i) => i.date));
    const d = new Date();
    if (!days.has(todayStr())) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (days.has(dateStr(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // ---------- sound ----------
  function say(text) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  function speak(item) {
    if (item.type === 'word' && item.audio) {
      new Audio(item.audio).play().catch(() => say(item.text));
      return;
    }
    say(item.text);
  }

  return {
    DEFAULT_GOAL,
    STREAK_MILESTONES,
    todayStr,
    dateStr,
    getItems,
    getSettings,
    saveSettings,
    updateItem,
    deleteItem,
    classify,
    addItem,
    lookupWord,
    askOpenAI,
    enrichItem,
    computeStreak,
    speak,
  };
})();
