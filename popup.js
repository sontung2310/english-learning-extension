let tab = 'word';
let items = [];
let settings = {};
let prevCount = null;

const tabButtons = document.querySelectorAll('.tabs button');

function render() {
  UI.renderEngage(document.getElementById('engage'), items, settings);
  UI.renderStats(document.getElementById('stats'), items);

  tabButtons.forEach((b) => {
    const type = b.dataset.tab;
    const n = items.filter((i) => i.type === type).length;
    b.textContent = `${type === 'word' ? 'Words' : 'Sentences'} (${n})`;
    b.classList.toggle('active', type === tab);
  });

  UI.renderGrouped(
    document.getElementById('list'),
    items.filter((i) => i.type === tab),
    UI.emptyText(tab)
  );
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

UI.renderAddForm(document.getElementById('addForm'), async (text) => {
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

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.items || changes.settings)) load();
});

load();
