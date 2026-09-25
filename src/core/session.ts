// Change list, undo/redo history and persistence. commit() is the single path
// by which the change list and the page DOM are modified.
import { isStoredChange, serialize, type Change, type HistoryEntry, type PageRef, type Patch } from "./changes";
import { HOST_TAG, setOriginalTextLookup, textOf } from "./describe";
import * as engine from "./engine";
import { elementOf, idOf } from "./registry";
import { store } from "./store";
import type { ChangeStore } from "./types";

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
let nextChangeId = 1;
let backend: ChangeStore | null = null;
let loaded: Promise<void> | null = null;

export const currentPageKey = () => `${location.origin}${location.pathname}${location.search}`;

export function currentPage(): PageRef {
  return { key: currentPageKey(), url: location.href, title: document.title };
}

export const isOnCurrentPage = (c: Change) => c.page.key === currentPageKey();

export function newChangeId(): string {
  return `ch_${nextChangeId++}`;
}

setOriginalTextLookup((el) => {
  const c = changes().find((c) => c.type === "edit" && elementOf(c.elementId) === el);
  return c?.type === "edit" ? c.oldText : undefined;
});

export function changes(): Change[] {
  return store.get().changes;
}

export function findChange(elementId: string, type: Change["type"]): Change | undefined {
  return changes().find((c) => c.elementId === elementId && c.type === type);
}

function applyToList(list: Change[], patch: Patch, dir: "forward" | "back"): Change[] {
  const to = dir === "forward" ? patch.after : patch.before;
  const i = list.findIndex((c) => c.id === patch.id);
  if (!to) return i === -1 ? list : list.filter((c) => c.id !== patch.id);
  if (i !== -1) return list.map((c) => (c.id === patch.id ? to : c));
  const at = Math.min(Math.max(patch.index, 0), list.length);
  return [...list.slice(0, at), to, ...list.slice(at)];
}

function run(patches: Patch[], dir: "forward" | "back") {
  let list = changes();
  const ordered = dir === "forward" ? patches : [...patches].reverse();
  for (const p of ordered) {
    if (dir === "forward") engine.transition(p.before, p.after);
    else engine.transition(p.after, p.before);
    list = applyToList(list, p, dir);
  }
  return list;
}

function update(list: Change[]) {
  store.set({ changes: list, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  const selected = elementOf(store.get().selectedId);
  if (selected && !(selected as HTMLElement).offsetParent && !selected.getClientRects().length) store.set({ selectedId: null });
  void persist(list);
}

/** Applies patches, records them as one undoable step. */
export function commit(label: string, patches: Patch[]) {
  if (!patches.length) return;
  const list = run(patches, "forward");
  undoStack.push({ label, patches });
  redoStack.length = 0;
  update(list);
}

export function undo(): string | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  const list = run(entry.patches, "back");
  redoStack.push(entry);
  update(list);
  return entry.label;
}

export function redo(): string | null {
  const entry = redoStack.pop();
  if (!entry) return null;
  const list = run(entry.patches, "forward");
  undoStack.push(entry);
  update(list);
  return entry.label;
}

/**
 * Patch that inserts a new change or replaces the existing one with the same id.
 * New changes go after the last change from the same page, so the list stays
 * grouped by page and numbers match the prompt.
 */
export function patchFor(before: Change | undefined, after: Change | null): Patch {
  const list = changes();
  const id = before?.id ?? after?.id ?? newChangeId();
  let index = list.length;
  if (before) index = list.findIndex((c) => c.id === before.id);
  else if (after) {
    const last = list.map((c) => c.page.key).lastIndexOf(after.page.key);
    if (last !== -1) index = last + 1;
  }
  return { id, before: before ?? null, after, index };
}

// ---- Persistence -----------------------------------------------------------

async function persist(list: Change[]) {
  try {
    await backend?.save(list.map(serialize));
  } catch (err) {
    console.warn("Reword: could not save changes", err);
  }
}

/** Loads the stored session once. Nothing on the page changes until `watch()` runs. */
export function load(changeStore: ChangeStore): Promise<void> {
  backend = changeStore;
  loaded ??= changeStore
    .load()
    .catch(() => [])
    .then((stored) => {
      const list = (Array.isArray(stored) ? stored : []).filter(isStoredChange).map((c) => ({
        ...c,
        segments: c.segments ?? [],
        sourceHints: c.sourceHints ?? [],
        elementId: null,
        ...(c.type === "move" ? { targetId: null } : {}),
      })) as Change[];
      for (const c of list) {
        const n = Number(c.id.replace(/^ch_/, ""));
        if (n >= nextChangeId) nextChangeId = n + 1;
      }
      store.set({ changes: list, pageKey: currentPageKey() });
    });
  return loaded;
}

function resolve(selector: string): Element | null {
  if (!selector) return null;
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 ? found[0]! : null;
  } catch {
    return null;
  }
}

/**
 * Where an edit's element went when its selector no longer matches (ids churn,
 * a sibling was inserted): the one element of the same tag whose copy is still
 * the original or the edited text.
 */
function resolveByText(c: Change): Element | null {
  if (c.type !== "edit") return null;
  const texts = [c.oldText, c.newText];
  const probe = (c.oldText.split("\n")[0] ?? "").slice(0, 24);
  const hits = Array.from(document.getElementsByTagName(c.tag)).filter(
    (el) => !el.closest(HOST_TAG) && (el.textContent ?? "").replace(/\s+/g, " ").includes(probe) && texts.includes(textOf(el)),
  );
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Resolves elements for this page's changes that aren't on the page (not found
 * yet, or replaced by a client-side re-render) and applies them. Changes from
 * other pages are left alone. Returns how many are still missing.
 */
function applyMissing(): number {
  let missing = 0;
  let touched = false;
  const list = changes().map((c) => {
    if (!isOnCurrentPage(c)) return c;
    if (elementOf(c.elementId) && (c.type !== "move" || elementOf(c.targetId))) return c;
    const el = resolve(c.selector) ?? resolveByText(c);
    const elementId = el ? idOf(el) : null;
    const target = c.type === "move" ? resolve(c.targetSelector) : null;
    const resolved = c.type === "move" ? { ...c, elementId, targetId: target ? idOf(target) : null } : { ...c, elementId };
    if (!resolved.elementId || (resolved.type === "move" && !resolved.targetId)) {
      missing++;
      return c;
    }
    touched = true;
    engine.apply(resolved);
    return resolved;
  });
  if (touched) store.set({ changes: list });
  return missing;
}

/**
 * Applies this page's changes and keeps them applied while the editor is open:
 * late-rendering pages (SPAs) get a few retries, client-side navigation and
 * framework re-renders are followed. Returns a function that stops watching.
 */
export function watch(): () => void {
  let stopped = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
  };
  const applyWithRetries = () => {
    if (!applyMissing()) return;
    for (const delay of [300, 1300, 3800]) later(applyMissing, delay);
  };

  // Client-side navigation (pushState, popstate) keeps this script alive, so follow URL changes.
  const checkUrl = () => {
    const key = currentPageKey();
    if (key === store.get().pageKey) return;
    store.set({ pageKey: key, selectedId: null, noteEditingId: null });
    applyWithRetries();
  };

  // Re-renders replace elements; throttled (not debounced) so animating pages still catch up.
  let pending = false;
  const observer = new MutationObserver((records) => {
    if (pending || records.every((r) => r.target instanceof Element && r.target.localName === HOST_TAG)) return;
    pending = true;
    later(() => {
      pending = false;
      applyMissing();
    }, 300);
  });

  store.set({ pageKey: currentPageKey() });
  applyWithRetries();
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  const onNavigate = () => later(checkUrl, 0);
  addEventListener("popstate", checkUrl);
  nav?.addEventListener("navigatesuccess", onNavigate);
  const interval = window.setInterval(checkUrl, 500);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    removeEventListener("popstate", checkUrl);
    nav?.removeEventListener("navigatesuccess", onNavigate);
    clearInterval(interval);
    observer.disconnect();
  };
}

/** Puts this page back the way it was (the stored session is kept). Used when this instance is replaced. */
export function unapplyAll() {
  for (const c of [...changes()].reverse()) engine.unapply(c);
}
