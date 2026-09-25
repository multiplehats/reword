export default defineBackground(() => {
  // Content scripts keep the change queue in storage.session.
  void browser.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !/^https?:/.test(tab.url ?? 'http:')) return;
    const message = { type: 'reword:toggle' };
    try {
      await browser.tabs.sendMessage(tab.id, message);
    } catch {
      // Tabs opened before the extension was installed/reloaded have no content script yet.
      try {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/content.js'] });
        await browser.tabs.sendMessage(tab.id, message);
      } catch (err) {
        console.warn('[reword] cannot run on this page', err);
      }
    }
  });
});
