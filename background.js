importScripts('lib.js');

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'save-english',
      title: 'Save "%s" to English Learner',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'save-english') return;
  const result = await LIB.addItem(info.selectionText || '');
  if (result.status === 'added') {
    flash('+1', '#16a34a');
    await LIB.enrichItem(result.id);
  } else if (result.status === 'duplicate') {
    flash('dup', '#d97706');
  }
});
