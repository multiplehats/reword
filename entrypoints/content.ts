import { createReword } from '@/src/core/reword';
import type { ChangeStore, PrefStore } from '@/src/core/types';

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
      return (got[key] as unknown[] | undefined) ?? [];
    },
    async save(changes) {
      if (changes.length) await browser.storage.session.set({ [key]: changes });
      else await browser.storage.session.remove(key);
    },
  };
}

const prefs: PrefStore = {
  async get(key) {
    return (await browser.storage.local.get(key))[key];
  },
  async set(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
};

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

interface CommandMessage {
  type: 'reword:command';
  name: string;
  params?: unknown;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    // If the background injects us again (tabs opened before install), WXT invalidates
    // the previous instance, which destroys its editor; this one takes over.
    const host = location.hostname;
    let siteEnabled = false;
    const reword = createReword({
      store: extensionStore(),
      prefs,
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
      void reword.open();
    };
    const toggle = () => (reword.opened ? reword.close() : open());

    // Toggle from the toolbar, and commands from other extension contexts
    // (a side panel, an agent bridge): { type: 'reword:command', name, params }.
    browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
      const m = msg as { type?: string } | null;
      if (m?.type === 'reword:toggle') toggle();
      if (m?.type === 'reword:command') {
        const { name, params } = m as CommandMessage;
        void reword.executeCommand(name, params).then(sendResponse);
        return true;
      }
      return undefined;
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

    ctx.onInvalidated(() => reword.destroy());
  },
});
