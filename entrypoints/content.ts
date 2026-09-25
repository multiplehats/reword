import { Overlay } from '@/src/core/overlay';
import type { Change, ChangeStore } from '@/src/core/types';

const OPEN_KEY = 'reword:open';
const SITES_KEY = 'reword:sites';

/**
 * Changes are kept per origin so you can queue edits across several pages and
 * reloads. Session storage is wiped when the browser closes, so old edits never
 * leak into a later prompt.
 */
function extensionStore(): ChangeStore {
  const key = `reword:changes:${location.origin}`;
  return {
    async load() {
      const got = await browser.storage.session.get(key);
      return (got[key] as Change[] | undefined) ?? [];
    },
    async save(changes) {
      if (changes.length) await browser.storage.session.set({ [key]: changes });
      else await browser.storage.session.remove(key);
    },
  };
}

async function enabledSites(): Promise<string[]> {
  const got = await browser.storage.local.get(SITES_KEY);
  return (got[SITES_KEY] as string[] | undefined) ?? [];
}

function session(value?: boolean): boolean {
  try {
    if (value === true) sessionStorage.setItem(OPEN_KEY, '1');
    else if (value === false) sessionStorage.removeItem(OPEN_KEY);
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    // If the background injects us again (tabs opened before install), WXT invalidates
    // the previous instance, which destroys its overlay; this one takes over.
    const host = location.hostname;
    let siteEnabled = false;
    const overlay = new Overlay({
      store: extensionStore(),
      onClose: () => session(false),
      siteToggle: {
        get: async () => (await enabledSites()).includes(host),
        async set(on) {
          const sites = new Set(await enabledSites());
          if (on) sites.add(host);
          else sites.delete(host);
          siteEnabled = on;
          await browser.storage.local.set({ [SITES_KEY]: [...sites] });
        },
      },
    });

    const open = () => {
      session(true);
      void overlay.open();
    };
    const toggle = () => (overlay.opened ? overlay.close() : open());

    browser.runtime.onMessage.addListener((msg: unknown) => {
      if ((msg as { type?: string })?.type === 'reword:toggle') toggle();
    });

    void enabledSites().then((sites) => {
      siteEnabled = sites.includes(host);
    });

    // Stay open across full page loads within this tab (multi-page marketing sites).
    if (session()) open();

    ctx.addEventListener(document, 'keydown', (e: KeyboardEvent) => {
      if (!siteEnabled || e.key.toLowerCase() !== 'e' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      e.preventDefault();
      toggle();
    });

    ctx.onInvalidated(() => overlay.destroy());
  },
});
