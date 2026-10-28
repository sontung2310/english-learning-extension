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
    // Old items saved before examples/chat existed get sane defaults.
    return items.map((i) => ({
      examples: i.example ? [i.example] : [],
      chat: [],
      ...i,
    }));
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

  // Wiktionary (via dictionaryapi.dev) and Azure both use the strict IPA
  // symbols: ɹ for the English r, ɡ for g. They are the correct symbols, but
  // no learner dictionary prints them - Cambridge, Oxford and Longman all use
  // r and g - so to a learner ɹ just reads as a broken character. Swapped at
  // display time only, and in one place, so the dictionary line and Azure's
  // line never disagree about how a sound is spelled.
  const IPA_PLAIN = { 'ɹ': 'r', 'ɡ': 'g' };
  const readableIpa = (text) => (text || '').replace(/[ɹɡ]/gu, (c) => IPA_PLAIN[c]);

  // ---------- lookups ----------
  async function lookupWord(word) {
    const res = await fetch(
      'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word)
    );
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return null;

    // dictionaryapi.dev lists several transcriptions per word: a British one
    // (usually the bare `phonetic` field) and an American one carrying the
    // -us.mp3 audio. Take them as a pair, American first - otherwise the card
    // showed British text while the speaker button played American audio, and
    // Azure scored against American English on top of that. "revamp" came out
    // as /ɹiːˈvamp/ next to a voice clearly saying /riˈvæmp/.
    const phonetics = entry.phonetics || [];
    const isUs = (p) => (p.audio || '').includes('-us.');
    const spoken =
      phonetics.find((p) => isUs(p) && p.text) ||
      phonetics.find((p) => p.text && p.audio) ||
      phonetics.find((p) => p.text) ||
      {};
    const phonetic = spoken.text || entry.phonetic || '';
    let audio = spoken.audio || (phonetics.find((p) => p.audio) || {}).audio || '';
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

  // Low-level call shared by every OpenAI feature (meaning lookup, more
  // examples, ask-a-question).
  async function openaiChat(apiKey, messages, jsonMode) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json.choices && json.choices[0] && json.choices[0].message.content) || '';
  }

  async function askOpenAI(apiKey, text, type) {
    const prompt =
      type === 'word'
        ? `Explain the English word "${text}" for a learner with basic English. Reply with JSON only, no other text: {"meaning":"simple meaning in one short sentence","example":"one short example sentence","ipa":"American English IPA for this exact word, wrapped in slashes, e.g. /rɪˈvæmpt/"}`
        : `Explain this English sentence for a learner with basic English. Reply with JSON only, no other text: {"meaning":"what it means, in simple English, 1 or 2 short sentences","example":"one other short example that uses a similar idea or phrase"}\n\nSentence: ${text}`;

    const reply = await openaiChat(apiKey, [{ role: 'user', content: prompt }], true);
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Bad reply from AI');
    return JSON.parse(match[0]);
  }

  // Ask for one more example sentence, different from the ones already saved.
  async function addExample(id) {
    const item = (await getItems()).find((i) => i.id === id);
    if (!item) return { error: 'not-found' };
    const { apiKey } = await getSettings();
    if (!apiKey) return { error: 'no-key' };

    const existing = item.examples.length ? item.examples : item.example ? [item.example] : [];
    const prompt = `Give one more short example sentence using the English ${item.type} "${item.text}"${
      item.meaning ? ` (meaning: ${item.meaning})` : ''
    }. It must be different from these existing examples: ${JSON.stringify(
      existing
    )}. Reply with JSON only, no other text: {"example":"the new example sentence"}`;

    try {
      const reply = await openaiChat(apiKey, [{ role: 'user', content: prompt }], true);
      const match = reply.match(/\{[\s\S]*\}/);
      const example = match && JSON.parse(match[0]).example;
      if (!example) throw new Error('Bad reply from AI');
      await updateItem(id, { examples: [...existing, example] });
      return { status: 'added' };
    } catch (e) {
      return { error: 'request-failed', message: e.message };
    }
  }

  // Ask a free-form question about a saved word/sentence, keeping a per-item
  // chat thread so follow-up questions have context.
  async function askAboutItem(id, question) {
    const item = (await getItems()).find((i) => i.id === id);
    if (!item) return { error: 'not-found' };
    const { apiKey } = await getSettings();
    if (!apiKey) return { error: 'no-key' };

    const chat = item.chat;
    const userMsg = { role: 'user', content: question, ts: Date.now() };
    await updateItem(id, { chat: [...chat, userMsg] });

    const system = `You are helping an English learner understand the ${item.type} "${item.text}"${
      item.meaning ? ` (meaning: ${item.meaning})` : ''
    }. Answer their questions simply and briefly.`;
    const messages = [
      { role: 'system', content: system },
      ...chat.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    try {
      const reply = await openaiChat(apiKey, messages, false);
      await updateItem(id, { chat: [...chat, userMsg, { role: 'assistant', content: reply.trim(), ts: Date.now() }] });
      return { status: 'answered' };
    } catch (e) {
      await updateItem(id, {
        chat: [...chat, userMsg, { role: 'assistant', content: `(error: ${e.message})`, ts: Date.now() }],
      });
      return { error: 'request-failed', message: e.message };
    }
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

    // Inflected forms are the common case here: dictionaryapi.dev has an entry
    // for "revamped" but no transcription on it, and none at all for
    // "ubiquitously". Those are exactly the forms a learner selects off a web
    // page, and they were landing with no IPA at all. The AI call already runs
    // for a missing meaning, so a missing pronunciation rides along on it.
    const needsIpa = item.type === 'word' && !info.phonetic;
    if (!info.meaning || !info.example || needsIpa) {
      const { apiKey } = await getSettings();
      if (apiKey) {
        try {
          const ai = await askOpenAI(apiKey, item.text, item.type);
          info.meaning = info.meaning || ai.meaning || '';
          info.example = info.example || ai.example || '';
          info.phonetic = info.phonetic || (item.type === 'word' ? ai.ipa || '' : '');
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
    readableIpa,
    openaiChat,
    askOpenAI,
    addExample,
    askAboutItem,
    enrichItem,
    computeStreak,
    speak,
  };
})();
