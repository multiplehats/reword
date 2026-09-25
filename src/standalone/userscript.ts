import { bindHotkey, boot, wasOpen } from './boot';

declare const GM_registerMenuCommand: ((name: string, fn: () => void, key?: string) => void) | undefined;

if (window.top === window.self) {
  const api = boot('userscript');
  bindHotkey(api);
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Toggle copy editor (Alt+Shift+E)', () => api.toggle(), 'e');
  if (wasOpen()) void api.open();
}
