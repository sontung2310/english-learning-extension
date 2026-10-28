let tab = 'word';
let items = [];
let settings = {};
let selectedDate = null;
let view = new Date();
view.setDate(1);
let prevCount = null;

const $ = (id) => document.getElementById(id);
const tabButtons = document.querySelectorAll('.tabs button');
const tabName = () => (tab === 'word' ? 'words' : 'sentences');

function renderCalendar() {
  const y = view.getFullYear();
  const m = view.getMonth();
  const today = LIB.todayStr();

  const counts = {};
  items
    .filter((i) => i.type === tab)
    .forEach((i) => (counts[i.date] = (counts[i.date] || 0) + 1));

  $('monthTitle').textContent = view.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const monthTotal = Object.entries(counts)
    .filter(([d]) => d.startsWith(prefix))
    .reduce((sum, [, n]) => sum + n, 0);
  $('monthTotal').textContent = `${monthTotal} ${tabName()} this month`;

  const cal = $('cal');
  cal.replaceChildren();
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => cal.append(UI.el('div', 'dow', d)));

  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  for (let i = 0; i < offset; i++) cal.append(UI.el('div', 'blank'));

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = LIB.dateStr(new Date(y, m, d));
    const n = counts[ds] || 0;
    const btn = UI.el('button', 'day');
    btn.append(UI.el('span', '', String(d)));
    if (n) btn.append(UI.el('span', 'count', String(n)));
    if (n) btn.classList.add('has');
    if (ds === today) btn.classList.add('today');
    if (ds === selectedDate) btn.classList.add('selected');
    btn.onclick = () => {
      selectedDate = selectedDate === ds ? null : ds;
      render();
    };
    cal.append(btn);
  }
}

function renderList() {
  const list = items.filter((i) => i.type === tab && (!selectedDate || i.date === selectedDate));

  const bar = $('filterBar');
  bar.replaceChildren();
  if (selectedDate) {
    bar.append(UI.el('span', '', `Showing ${UI.formatDate(selectedDate)} (${list.length})`));
    const clear = UI.el('button', 'ghost', 'Show all days');
    clear.onclick = () => {
      selectedDate = null;
      render();
    };
    bar.append(clear);
  } else {
    bar.append(UI.el('span', 'muted', `All days (${list.length} ${tabName()})`));
  }

  UI.renderGrouped($('list'), list, UI.emptyText(tab), { enableSpeech: true });
}

function render() {
  UI.renderEngage($('engage'), items, settings);
  UI.renderStats($('stats'), items);
  tabButtons.forEach((b) => {
    const type = b.dataset.tab;
    const n = items.filter((i) => i.type === type).length;
    b.textContent = `${type === 'word' ? 'Words' : 'Sentences'} (${n})`;
    b.classList.toggle('active', type === tab);
  });
  renderCalendar();
  renderList();
}

async function load() {
  items = await LIB.getItems();
  settings = await LIB.getSettings();
  if (prevCount !== null && items.length === prevCount + 1) {
    const streak = LIB.computeStreak(items);
    UI.toast(LIB.STREAK_MILESTONES.includes(streak) ? `🔥 ${streak}-day streak!` : 'Saved! +1');
  }
  prevCount = items.length;
  render();
}

UI.renderAddForm($('addForm'), async (text) => {
  const result = await LIB.addItem(text);
  if (result.status === 'added') await LIB.enrichItem(result.id);
  return result;
});

tabButtons.forEach((b) =>
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    render();
  })
);

$('prev').onclick = () => {
  view.setMonth(view.getMonth() - 1);
  render();
};
$('next').onclick = () => {
  view.setMonth(view.getMonth() + 1);
  render();
};

// settings
$('gear').onclick = async () => {
  const panel = $('settings');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const s = await LIB.getSettings();
    $('apiKey').value = s.apiKey || '';
    $('dailyGoal').value = s.dailyGoal || LIB.DEFAULT_GOAL;
    $('azureKey').value = s.azureKey || '';
    $('azureRegion').value = s.azureRegion || '';
  }
};

$('saveKey').onclick = async () => {
  const s = await LIB.getSettings();
  s.apiKey = $('apiKey').value.trim();
  s.azureKey = $('azureKey').value.trim();
  s.azureRegion = $('azureRegion').value.trim().toLowerCase();
  const goal = parseInt($('dailyGoal').value, 10);
  s.dailyGoal = Number.isFinite(goal) && goal > 0 ? goal : LIB.DEFAULT_GOAL;
  await LIB.saveSettings(s);
  $('saveMsg').textContent = 'Saved.';
  setTimeout(() => ($('saveMsg').textContent = ''), 2000);
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.items || changes.settings)) load();
});

load();
