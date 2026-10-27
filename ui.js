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

  function card(item) {
    const c = el('div', 'card');
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

    if (item.meaning) c.append(el('div', 'meaning', item.meaning));
    if (item.example) c.append(el('div', 'example', `Example: ${item.example}`));

    if (item.note) {
      const note = el('div', 'note', item.note + ' ');
      const retry = el('button', 'link', 'Try again');
      retry.onclick = () => LIB.enrichItem(item.id);
      note.append(retry);
      c.append(note);
    }
    return c;
  }

  function renderGrouped(container, items, emptyText) {
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
        list.forEach((i) => container.append(card(i)));
      });
  }

  const emptyText = (tab) =>
    tab === 'word'
      ? 'No words yet. Select a word on any page, right click, and choose "Save to English Learner".'
      : 'No sentences yet. Select a sentence on any page, right click, and choose "Save to English Learner".';

  return { el, formatDate, renderStats, renderGrouped, emptyText, renderEngage, renderAddForm, toast };
})();
