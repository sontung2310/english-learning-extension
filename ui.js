// Shared UI pieces for the popup and the full page.
const UI = (() => {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function formatDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function renderStats(container, items) {
    const today = LIB.todayStr();
    const count = (type, onlyToday) =>
      items.filter((i) => i.type === type && (!onlyToday || i.date === today)).length;
    container.replaceChildren();
    [
      ['Words today', count('word', true)],
      ['Sentences today', count('sentence', true)],
      ['Total words', count('word')],
      ['Total sentences', count('sentence')],
    ].forEach(([label, n]) => {
      const tile = el('div', 'tile');
      tile.append(el('div', 'num', String(n)), el('div', 'label', label));
      container.append(tile);
    });
  }

  function renderEngage(container, items, settings) {
    const streak = LIB.computeStreak(items);
    const goal = settings.dailyGoal || LIB.DEFAULT_GOAL;
    const todayCount = items.filter((i) => i.date === LIB.todayStr()).length;
    const pct = Math.min(100, Math.round((todayCount / goal) * 100));

    container.classList.toggle('has-streak', streak > 0);
    container.replaceChildren();
    const streakEl = el('div', 'streak');
    streakEl.append(
      el('span', 'flame' + (streak ? ' active' : ''), streak ? '🔥' : '💤'),
      el('span', '', streak ? `${streak}-day streak` : 'Start a streak today')
    );

    const goalEl = el('div', 'goal' + (pct >= 100 ? ' met' : ''));
    goalEl.append(el('span', '', `${todayCount} / ${goal} today${pct >= 100 ? ' ✓' : ''}`));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = pct + '%';
    track.append(fill);
    goalEl.append(track);

    container.append(streakEl, goalEl);
  }

  function renderAddForm(container, onAdd) {
    container.replaceChildren();
    const input = el('input', 'add-input');
    input.type = 'text';
    input.name = 'add';
    input.setAttribute('aria-label', 'Word or sentence to save');
    input.placeholder = 'Type a word or sentence, then press Enter';
    const msg = el('span', 'muted add-msg');

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      const result = await onAdd(value);
      msg.textContent =
        result.status === 'added' ? 'Saved!' : result.status === 'duplicate' ? 'Already saved.' : '';
      if (msg.textContent) setTimeout(() => (msg.textContent = ''), 2000);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const btn = el('button', 'primary', 'Add');
    btn.onclick = submit;

    container.append(input, btn, msg);
  }

  let toastTimer = null;
  function toast(message) {
    let box = document.getElementById('ui-toast');
    if (!box) {
      box = el('div', 'toast');
      box.id = 'ui-toast';
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.remove('show');
    void box.offsetWidth; // restart the CSS transition
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 2200);
  }

  // A coloured label in the left column replaces the old "Example:" prefix.
  // Only the first line is labelled, so repeats read as one list.
  function labelled(cls, label, text) {
    const row = el('div', cls);
    row.append(el('span', 'tag', label), el('span', 'val', text));
    return row;
  }

  function renderExamples(c, item) {
    const examples = item.examples && item.examples.length ? item.examples : item.example ? [item.example] : [];
    const wrap = el('div', 'examples');
    examples.forEach((ex, i) => wrap.append(labelled('example', i ? '' : 'Example', ex)));

    const more = el('button', 'link', '+ More examples');
    more.onclick = async () => {
      more.disabled = true;
      more.textContent = 'Asking...';
      const result = await LIB.addExample(item.id);
      if (result.error === 'no-key') {
        more.replaceWith(el('span', 'muted', 'Add your OpenAI API key in Settings to get more examples.'));
      } else if (result.error) {
        more.disabled = false;
        more.textContent = '+ More examples';
        UI.toast('Could not get another example.');
      }
      // On success the storage change listener re-renders the whole list.
    };
    wrap.append(more);
    c.append(wrap);
  }

  const expandedChats = new Set();

  function renderAsk(c, item) {
    const wrap = el('div', 'ask');
    const toggle = el('button', 'link', expandedChats.has(item.id) ? 'Hide chat' : '💬 Ask a question');
    toggle.onclick = () => {
      if (expandedChats.has(item.id)) expandedChats.delete(item.id);
      else expandedChats.add(item.id);
      toggle.textContent = expandedChats.has(item.id) ? 'Hide chat' : '💬 Ask a question';
      panel.hidden = !expandedChats.has(item.id);
    };
    wrap.append(toggle);

    const panel = el('div', 'chat-panel');
    panel.hidden = !expandedChats.has(item.id);

    const thread = el('div', 'chat-thread');
    (item.chat || []).forEach((m) => thread.append(el('div', `bubble ${m.role}`, m.content)));
    panel.append(thread);

    const row = el('div', 'chat-row');
    const input = el('input', 'chat-input');
    input.type = 'text';
    input.placeholder = `Ask about "${item.text.slice(0, 30)}"...`;
    const send = el('button', 'primary', 'Send');
    const submit = async () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      input.disabled = true;
      send.disabled = true;
      const result = await LIB.askAboutItem(item.id, q);
      if (result.error === 'no-key') {
        panel.append(el('div', 'muted', 'Add your OpenAI API key in Settings to ask questions.'));
        input.disabled = false;
        send.disabled = false;
      }
      // On success the storage change listener re-renders with the new reply.
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    send.onclick = submit;
    row.append(input, send);
    panel.append(row);

    wrap.append(panel);
    c.append(wrap);
  }

  // Only one microphone session may be live at a time. Tracked here so a
  // re-render (or starting another card) always releases the previous mic.
  let activeSession = null;
  function stopActiveSession() {
    if (activeSession) {
      activeSession.cancel();
      activeSession = null;
    }
  }

  const scoreBand = (score) => (score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 50 ? 'ok' : 'poor');
  const round = (n) => (typeof n === 'number' ? Math.round(n) : null);

  // Seven bars driven by live microphone energy, so the user can see that it
  // is listening before they have said anything.
  function buildMeter() {
    const meter = el('div', 'meter');
    const bars = [];
    for (let i = 0; i < 7; i++) {
      const bar = el('span', 'bar');
      bars.push(bar);
      meter.append(bar);
    }
    // Middle bars react most, which reads as a voice rather than a progress bar.
    const weights = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45];
    meter.setLevel = (level) =>
      bars.forEach((bar, i) => {
        bar.style.transform = `scaleY(${(0.22 + level * weights[i] * 1.5).toFixed(3)})`;
      });
    return meter;
  }

  // ---------- result pieces ----------

  // A run of units (syllables, sounds, words) coloured green or red. The
  // colour is the whole message, so every unit carries its own score as a
  // tooltip rather than hiding behind one overall number.
  function renderUnits(units, sep, cls) {
    const line = el('div', `pron-line${cls ? ` ${cls}` : ''}`);
    units.forEach((u, i) => {
      if (i && sep) line.append(el('span', 'sep', sep));
      const span = el('span', u.ok ? 'ok' : 'bad', u.text);
      if (typeof u.score === 'number') span.title = `${Math.round(u.score)}/100`;
      if (u.onClick) {
        span.classList.add('tappable');
        span.onclick = u.onClick;
      }
      line.append(span);
    });
    return line;
  }

  // Dictionary IPA already arrives wrapped in slashes; Azure's does not.
  const slashed = (ipa) => (/^\/.*\/$/.test(ipa) ? ipa : `/${ipa}/`);

  function ipaRow(label, inner) {
    const row = el('div', 'ipa-row');
    row.append(el('span', 'ipa-label muted', label), inner);
    return row;
  }

  // The learner's own sounds, slot by slot, between slashes so it reads as IPA
  // and not as a spelling.
  function spokenIpaLine(slots) {
    const line = el('span', 'ipa pron-line');
    line.append(el('span', 'slash', '/'));
    slots.forEach((s) => {
      const span = el('span', s.ok ? 'ok' : 'bad', s.spoken);
      if (typeof s.score === 'number') {
        span.title = s.ok
          ? `${Math.round(s.score)}/100`
          : `expected ${s.expected} - ${Math.round(s.score)}/100`;
      }
      line.append(span);
    });
    line.append(el('span', 'slash', '/'));
    return line;
  }

  function scoreRow(score, label) {
    const row = el('div', 'pron-scorerow');
    row.append(
      el('span', `pron-score ${scoreBand(score)}`, `${Math.round(score)}%`),
      el('span', 'pron-label', label || PRON.scoreLabel(score))
    );
    return row;
  }

  // One PTE dimension: name, bar, number, and a plain-English note on what the
  // number is actually counting.
  function pteRow(label, score, note) {
    const row = el('div', 'pte-row');
    const value = Math.max(0, Math.min(100, score || 0));
    const track = el('div', 'pte-track');
    const fill = el('div', `pte-fill ${scoreBand(value)}`);
    fill.style.width = `${value}%`;
    track.append(fill);
    row.append(
      el('span', 'pte-label', label),
      track,
      el('span', `pte-num ${scoreBand(value)}`, String(Math.round(value))),
      el('span', 'pte-note muted', note || '')
    );
    return row;
  }

  // What dragged the content score down, in words rather than a percentage.
  function contentNote(words) {
    const missed = words.filter((w) => w.errorType === 'Omission').length;
    const extra = words.filter((w) => w.errorType === 'Insertion').length;
    const parts = [];
    if (missed) parts.push(`${missed} word${missed > 1 ? 's' : ''} not said`);
    if (extra) parts.push(`${extra} extra word${extra > 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'every word said';
  }

  function renderPractice(c, item) {
    const wrap = el('div', 'practice');
    const head = el('div', 'practice-head');
    head.append(el('span', 'practice-title', '🎤 Pronunciation'));
    const hear = el('button', 'ghost tiny', '🔊 Hear it');
    hear.title = 'Listen to the correct pronunciation';
    hear.onclick = () => LIB.speak(item);
    head.append(el('span', 'spacer'), hear);
    wrap.append(head);

    // No echo of the word here: the card title sits directly above, and the
    // syllable breakdown worth showing is the one Azure returns after an
    // attempt, scored sound by sound.
    const stage = el('div', 'pron-stage');
    wrap.append(stage);
    c.append(wrap);

    const showIdle = (retry) => {
      stage.replaceChildren();
      const start = el('button', 'primary mic-btn', retry ? '🎤 Try again' : '🎤 Start speaking');
      start.onclick = begin;
      stage.append(start);
      if (!retry) stage.append(el('div', 'muted hint', 'Press start, then say it out loud.'));
    };

    const showError = (code) => {
      stage.replaceChildren();
      stage.append(el('div', 'pron-error', PRON.ERRORS[code] || PRON.ERRORS.error));
      const retry = el('button', 'primary mic-btn', '🎤 Try again');
      retry.onclick = begin;
      stage.append(retry);
    };

    function begin() {
      stopActiveSession();
      stage.replaceChildren();

      const status = el('div', 'pron-status', 'Opening microphone...');
      const meter = buildMeter();
      const countdown = el('span', 'pron-countdown');
      const stop = el('button', 'ghost', 'Stop');

      const row = el('div', 'pron-live');
      row.append(meter, status, el('span', 'spacer'), countdown, stop);
      stage.append(row);

      let done = false;
      stop.onclick = () => {
        if (!done && activeSession) activeSession.stop();
      };

      // The countdown is reassurance that the wait is bounded while nothing is
      // happening. Once they are talking it would just be a clock ticking at
      // them, so it goes away.
      let waiting = true;
      activeSession = PRON.createSession({
        onState(state) {
          if (state === 'listening') status.textContent = 'Listening - speak now';
          else if (state === 'speaking') {
            status.textContent = 'I can hear you...';
            waiting = false;
            countdown.textContent = '';
          } else if (state === 'scoring') {
            status.textContent = 'Checking...';
            stop.disabled = true;
            waiting = false;
            countdown.textContent = '';
          }
        },
        onLevel: (level) => meter.setLevel(level),
        onTick: (seconds) => {
          if (waiting) countdown.textContent = seconds ? `${seconds}s` : '';
        },
        onDone(result) {
          done = true;
          activeSession = null;
          if (result.cancelled) return;
          if (result.error) {
            showError(result.error);
            return;
          }
          score(result.audio);
        },
      });
    }

    // Azure judges the phonemes against the target text, so unlike a
    // transcript it cannot quietly correct a mispronounced word into the real
    // one. It is the only grader; there is nothing to fall back to, so a
    // failure says so plainly instead of inventing a number.
    async function score(audio) {
      stage.replaceChildren();
      const row = el('div', 'pron-live');
      row.append(buildMeter(), el('div', 'pron-status', 'Scoring your sounds...'));
      stage.append(row);

      const a = await PRON.azureAssess(item.text, item.type, audio);
      if (a.error) {
        showError(a.error);
        return;
      }
      showResult(a);
    }

    // One word: the sounds it needs, the sounds that came out, and which of
    // them to work on.
    function wordResult(a) {
      const box = el('div', 'result');

      // The dictionary's IPA is the nicer one - it carries stress marks - but
      // it is missing for plenty of words, so Azure's own reference sounds
      // stand in rather than leaving the learner nothing to aim at.
      const target = item.phonetic || (a.targetIpa ? slashed(a.targetIpa) : '');
      if (target) box.append(ipaRow('Target', el('span', 'ipa', target)));

      if (a.spokenIpa && a.spokenIpa.length) {
        box.append(ipaRow('You said', spokenIpaLine(a.spokenIpa)));
      } else {
        box.append(el('div', 'muted', 'No sounds were picked up for this word.'));
      }

      // One syllable is just the word printed twice, so the breakdown only
      // earns its place when it actually splits something.
      if (a.syllables && a.syllables.length > 1) box.append(renderUnits(a.syllables, '·', 'syllables'));

      box.append(scoreRow(a.score));
      const detail = [];
      if (a.accuracy !== null) detail.push(`accuracy ${round(a.accuracy)}`);
      if (a.prosody !== null) detail.push(`stress ${round(a.prosody)}`);
      if (a.ms) detail.push(`${(a.ms / 1000).toFixed(1)}s`);
      box.append(el('div', 'grade-detail muted', detail.join(' · ')));
      return box;
    }

    // A sentence, marked the way a PTE speaking examiner marks a read-aloud:
    // did you say all of it (content), did each word come out right
    // (pronunciation), and did it flow (fluency).
    function sentenceResult(a) {
      const box = el('div', 'result');
      box.append(scoreRow(a.score, `Overall - ${PRON.scoreLabel(a.score)}`));

      if (a.completeness !== null) box.append(pteRow('Content', a.completeness, contentNote(a.words)));
      if (a.accuracy !== null) box.append(pteRow('Pronunciation', a.accuracy, 'sounds in each word'));
      if (a.fluency !== null) box.append(pteRow('Fluency', a.fluency, 'pace and pauses'));
      if (a.prosody !== null) box.append(pteRow('Prosody', a.prosody, 'rhythm and stress'));

      // Every word, coloured by its own score. Tap one to see the sounds
      // inside it - a red word on its own does not tell you what to fix.
      const detail = el('div', 'word-detail');
      const units = a.words.map((w) => ({
        text: w.errorType === 'Insertion' ? `+${w.text}` : w.text,
        score: w.score,
        ok: w.ok,
        onClick: () => showWordDetail(detail, w),
      }));
      box.append(el('div', 'pte-caption muted', 'Tap a word to see what went wrong'), renderUnits(units, ' ', 'words'), detail);

      const foot = [a.heard ? `heard: "${a.heard}"` : '', a.ms ? `${(a.ms / 1000).toFixed(1)}s` : '']
        .filter(Boolean)
        .join(' · ');
      if (foot) box.append(el('div', 'pron-heard muted', foot));
      return box;
    }

    function showWordDetail(host, w) {
      host.replaceChildren();
      const title = el('div', 'word-detail-head');
      title.append(el('strong', '', w.text));
      if (w.errorType) title.append(el('span', 'word-flag', w.errorType === 'Omission' ? 'not said' : w.errorType.toLowerCase()));
      else title.append(el('span', `pron-score tiny-score ${scoreBand(w.score)}`, `${round(w.score)}%`));
      host.append(title);

      if (w.errorType === 'Omission') {
        host.append(el('div', 'muted', 'This word was skipped. Say the whole sentence without missing a word.'));
        return;
      }
      if (w.ipa) host.append(ipaRow('Target', el('span', 'ipa', slashed(w.ipa))));
      if (w.slots && w.slots.length) host.append(ipaRow('You said', spokenIpaLine(w.slots)));
      if (w.syllables && w.syllables.length > 1) host.append(renderUnits(w.syllables, '·', 'syllables'));
    }

    // Azure gives numbers; a learner needs a sentence telling them what to do
    // about them. Only the numbers are sent, never the audio.
    async function renderCoach(host, a) {
      const note = el('div', 'tutor-feedback muted', '👩‍🏫 Writing your feedback...');
      host.append(note);
      const res = await PRON.coach(item.text, item.type, a);
      if (res.error === 'no-key') {
        note.textContent = 'Add your OpenAI API key in Settings for coach feedback.';
        return;
      }
      if (res.error) {
        note.textContent = 'Coach feedback unavailable right now.';
        return;
      }
      note.classList.remove('muted');
      note.textContent = `👩‍🏫 ${res.feedback}`;
    }

    function showResult(a) {
      stage.replaceChildren();
      stage.append(item.type === 'word' ? wordResult(a) : sentenceResult(a));

      const again = el('button', 'primary mic-btn', '🎤 Try again');
      again.onclick = begin;
      stage.append(again);

      const coachHost = el('div');
      stage.append(coachHost);
      renderCoach(coachHost, a);
    }

    showIdle(false);
  }

  // The rail colour comes from the word, so a word keeps the same colour from
  // one render to the next. The colour carries no meaning.
  const RAILS = 12;
  const railOf = (text) => {
    let h = 2166136261; // FNV-1a, so similar words still land on different rails
    for (const ch of text) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % RAILS;
  };

  // Two cards near each other must never share a rail, so a clash moves to the
  // next free colour. `used` is a sliding window of the last RAILS - 1 colours
  // (a Set keeps insertion order, so the oldest is first), which makes any
  // RAILS consecutive cards all different. Longer lists have to repeat.
  function railPicker() {
    const used = new Set();
    return (text) => {
      if (used.size >= RAILS) used.delete(used.values().next().value);
      let rail = railOf(text);
      while (used.has(rail)) rail = (rail + 1) % RAILS;
      used.add(rail);
      return rail;
    };
  }

  function card(item, opts = {}, rail = railOf(item.text)) {
    const c = el('div', `card rail-${rail}`);
    const top = el('div', 'top');
    top.append(el('span', 'term', item.text));
    if (item.phonetic) top.append(el('span', 'phonetic', item.phonetic));
    top.append(el('span', 'spacer'));

    const listen = el('button', 'icon', '🔊');
    listen.title = 'Listen';
    listen.onclick = () => LIB.speak(item);

    const del = el('button', 'icon', '✕');
    del.title = 'Delete';
    del.onclick = async () => {
      if (confirm(`Delete "${item.text.slice(0, 40)}"?`)) await LIB.deleteItem(item.id);
    };

    top.append(listen, del);
    c.append(top);

    if (item.meaning) c.append(labelled('meaning', 'Meaning', item.meaning));
    renderExamples(c, item);

    if (item.note) {
      const note = el('div', 'note', item.note + ' ');
      const retry = el('button', 'link', 'Try again');
      retry.onclick = () => LIB.enrichItem(item.id);
      note.append(retry);
      c.append(note);
    }

    renderAsk(c, item);
    if (opts.enableSpeech) renderPractice(c, item);

    return c;
  }

  function renderGrouped(container, items, emptyText, opts) {
    stopActiveSession(); // never leave a microphone open across a re-render
    const pickRail = railPicker();
    container.replaceChildren();
    if (!items.length) {
      container.append(el('div', 'empty', emptyText));
      return;
    }
    const groups = {};
    items.forEach((i) => (groups[i.date] ||= []).push(i));
    const today = LIB.todayStr();
    Object.keys(groups)
      .sort()
      .reverse()
      .forEach((date) => {
        const list = groups[date].sort((a, b) => b.createdAt - a.createdAt);
        const label = `${date === today ? 'Today, ' : ''}${formatDate(date)} (${list.length})`;
        container.append(el('h3', 'day', label));
        list.forEach((i) => container.append(card(i, opts, pickRail(i.text))));
      });
  }

  const emptyText = (tab) =>
    tab === 'word'
      ? 'No words yet. Select a word on any page, right click, and choose "Save to English Learner".'
      : 'No sentences yet. Select a sentence on any page, right click, and choose "Save to English Learner".';

  return {
    el,
    formatDate,
    renderStats,
    renderGrouped,
    emptyText,
    renderEngage,
    renderAddForm,
    toast,
  };
})();
