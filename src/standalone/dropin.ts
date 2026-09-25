import { bindHotkey, boot, rememberOpen, wasOpen } from './boot';

/**
 * First-party drop-in. Include with:
 *   <script src="/reword-dropin.js" defer></script>
 * It stays inert unless the page is on a dev host or has ?copyedit=1.
 * Add data-always to the script tag to allow it on any host.
 */
const script = document.currentScript as HTMLScriptElement | null;
const params = new URLSearchParams(location.search);
const flag = params.get('copyedit');
const devHost = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$|\.(local|localhost|test)$/.test(location.hostname);
const allowed = devHost || flag != null || script?.hasAttribute('data-always');

if (allowed && window.top === window.self) {
  const api = boot('drop-in');
  bindHotkey(api);
  if (flag === '0') rememberOpen(false);
  else if (flag === '1' || wasOpen()) void api.open();
}
