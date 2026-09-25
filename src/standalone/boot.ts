import { Overlay } from '../core/overlay';
import type { Change, ChangeStore } from '../core/types';

const CHANGES_KEY = 'reword:changes';
const OPEN_KEY = 'reword:open';

/** Per-tab, per-origin storage. Survives reloads and page-to-page navigation in the same tab. */
function sessionStore(): ChangeStore {
  return {
    async load() {
      try {
        return JSON.parse(sessionStorage.getItem(CHANGES_KEY) ?? '[]') as Change[];
      } catch {
        return [];
      }
    },
    async save(changes) {
      try {
        if (changes.length) sessionStorage.setItem(CHANGES_KEY, JSON.stringify(changes));
        else sessionStorage.removeItem(CHANGES_KEY);
      } catch {
        /* storage blocked — keep in memory only */
      }
    },
  };
}

export function rememberOpen(open: boolean) {
  try {
    if (open) sessionStorage.setItem(OPEN_KEY, '1');
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    /* ignore */
  }
}

export function wasOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export interface RewordApi {
  overlay: Overlay;
  open(): Promise<void>;
  close(): void;
  toggle(): void;
  getPrompt(): string;
  getChanges(): Change[];
}

declare global {
  interface Window {
    Reword?: RewordApi;
  }
}

/** Create (once) the page-wide overlay and expose it as `window.Reword`. */
export function boot(flavor: string): RewordApi {
  if (window.Reword) return window.Reword;
  const overlay = new Overlay({ store: sessionStore(), flavor, onClose: () => rememberOpen(false) });
  const api: RewordApi = {
    overlay,
    open: async () => {
      rememberOpen(true);
      await overlay.open();
    },
    close: () => overlay.close(),
    toggle: () => (overlay.opened ? overlay.close() : void api.open()),
    getPrompt: () => overlay.getPrompt(),
    getChanges: () => overlay.getChanges(),
  };
  window.Reword = api;
  return api;
}

/** Alt+Shift+E toggles the overlay (used by the userscript and the drop-in). */
export function bindHotkey(api: RewordApi) {
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyE') {
      e.preventDefault();
      api.toggle();
    }
  });
}
