import {
  HOST_TAG, buildFallbackSelector, textRect, buildSelector, describe, isOwnNode, pickAt, pickableParent, query, snapshot, sourceHints,
} from './dom';
import { buildPrompt, toJSON } from './prompt';
import { CSS } from './styles';
import { extractText, normalize, truncate, type ExtractedText } from './text';
import type { Change, ChangeStore, ChangeType, OverlayOptions } from './types';
import { adoptStyles, copyText, downloadText, h, icon } from './ui';

type Tab = 'edit' | 'comment' | 'browse';

interface Active {
  el: Element;
  mode: ChangeType;
  original: ExtractedText;
  /** Restores the DOM to how it was before this edit session. */
  restore: () => void;
  /** Attributes we touched, to put back afterwards. */
  attrs: Record<string, string | null>;
  draft: string;
}

const EDIT_ATTRS = ['contenteditable', 'spellcheck', 'data-reword-editing'];
const INTERCEPT = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function memoryStore(): ChangeStore {
  let saved: Change[] = [];
  return { load: async () => saved, save: async (c) => void (saved = c) };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export class Overlay {
  private opts: OverlayOptions;
  private store: ChangeStore;
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private layer!: HTMLElement;
  private panel!: HTMLElement;
  private toastEl!: HTMLElement;
  private isOpen = false;

  private tab: Tab = 'edit';
  private pick = true;
  private highlightAll = false;
  private changes: Change[] = [];
  private refs = new Map<string, Element | null>();
  private restores = new Map<string, () => void>();
  private active: Active | null = null;
  private hover: Element | null = null;
  private flash: { el: Element; until: number } | null = null;
  private selectedId: string | null = null;
  private siteEnabled = false;

  private raf = 0;
  private lastUrl = '';
  private urlTimer = 0;
  private mo: MutationObserver | null = null;
  private refreshTimer = 0;
  private toastTimer = 0;
  private pointer = { x: -1, y: -1, dirty: false };
  private loaded: Promise<void>;

  constructor(opts: OverlayOptions = {}) {
    this.opts = opts;
    this.store = opts.store ?? memoryStore();
    this.loaded = this.store.load().then((c) => {
      this.changes = Array.isArray(c) ? c : [];
    }).catch(() => undefined);
  }

  get opened() {
    return this.isOpen;
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  async open() {
    if (this.isOpen) return;
    this.isOpen = true;
    await this.loaded;
    if (!this.isOpen) return;
    this.mount();
    if (this.opts.siteToggle) this.siteEnabled = await this.opts.siteToggle.get().catch(() => false);
    for (const type of INTERCEPT) window.addEventListener(type, this.onPointer, true);
    window.addEventListener('pointermove', this.onMove, { capture: true, passive: true });
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('popstate', this.checkUrl);
    window.addEventListener('hashchange', this.checkUrl);
    this.urlTimer = window.setInterval(this.checkUrl, 500);
    this.mo = new MutationObserver((records) => {
      if (records.every((r) => isOwnNode(r.target))) return;
      if (this.host && !this.host.isConnected) document.documentElement.append(this.host);
      this.scheduleRefresh();
    });
    this.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    this.lastUrl = location.href;
    this.refresh();
    this.render();
    this.loop();
  }

  close() {
    if (!this.isOpen) return;
    this.commitActive();
    this.isOpen = false;
    for (const type of INTERCEPT) window.removeEventListener(type, this.onPointer, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('popstate', this.checkUrl);
    window.removeEventListener('hashchange', this.checkUrl);
    clearInterval(this.urlTimer);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
    this.mo?.disconnect();
    this.mo = null;
    cancelAnimationFrame(this.raf);
    this.host?.remove();
    this.host = null;
    this.pool.clear();
    this.root = null;
    this.hover = null;
    this.opts.onClose?.();
  }

  toggle() {
    this.isOpen ? this.close() : void this.open();
  }

  /** Tear down without firing onClose (e.g. the content script is being replaced). */
  destroy() {
    const onClose = this.opts.onClose;
    this.opts.onClose = undefined;
    this.close();
    this.opts.onClose = onClose;
  }

  // -------------------------------------------------------------------------
  // Public helpers (also handy for debugging from the console)

  getChanges(): Change[] {
    return this.changes.slice();
  }

  getPrompt(): string {
    return buildPrompt(this.changes);
  }

  async copyPrompt() {
    if (!this.changes.length) return this.toast('Nothing queued yet');
    this.commitActive();
    const n = this.changes.length;
    const ok = await copyText(buildPrompt(this.changes), this.root!);
    this.toast(ok ? `Prompt copied (${n} change${n === 1 ? '' : 's'})` : 'Copy failed — use Export instead');
  }

  // -------------------------------------------------------------------------
  // DOM scaffolding

  private mount() {
    const host = document.createElement(HOST_TAG);
    const root = host.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    this.layer = h('div');
    this.panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Copy editor' });
    this.toastEl = h('div', { class: 'toast', role: 'status' });
    root.append(this.layer, this.panel, this.toastEl);
    // Keys typed into our panel must not reach page shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) this.panel.addEventListener(type, (e) => e.stopPropagation());
    document.documentElement.append(host);
    this.host = host;
    this.root = root;
  }

  // -------------------------------------------------------------------------
  // Events

  private isOwnEvent(e: Event) {
    return !!this.host && e.composedPath().includes(this.host);
  }

  private onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY, dirty: true };
  };

  private onScroll = () => {
    this.pointer.dirty = true;
  };

  private onPointer = (e: MouseEvent) => {
    if (!e.isTrusted || !this.pick || this.isOwnEvent(e)) return;
    const a = this.active;
    // Inside the element being edited: let the browser place the caret/select text,
    // but keep the page (links, buttons, routers) from reacting.
    if (a && a.mode === 'edit' && a.el.contains(e.target as Node)) {
      if (e.type === 'click' || e.type === 'auxclick' || e.type === 'dblclick') e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = pickAt(e.clientX, e.clientY);
    if (!target) {
      // Clicking empty space finishes the current edit but otherwise behaves normally.
      if (e.type === 'pointerdown' && a) a.mode === 'edit' ? this.commitEdit() : undefined;
      return;
    }
    if (e.type === 'contextmenu') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'click' || e.button !== 0) return;
    this.select(target, e.clientX, e.clientY);
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.isOwnEvent(e)) return this.onPanelKey(e);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      e.stopPropagation();
      void this.copyPrompt();
      return;
    }
    const a = this.active;
    if (a && a.mode === 'edit') {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.commitEdit();
        if (mod) this.setPick(true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancelEdit();
        return;
      }
      if (a.el.contains(e.target as Node) || document.activeElement === a.el) {
        // Typing belongs to the editor, not to page hotkeys / buttons / forms.
        e.stopPropagation();
        // Chrome treats Space inside a contenteditable <button> as activation and drops
        // the character, so insert it ourselves.
        if (e.key === ' ' && !e.isComposing && !mod && !e.altKey) {
          e.preventDefault();
          document.execCommand('insertText', false, ' ');
        }
        if (e.key === 'Enter' && !e.isComposing) {
          // Shift+Enter: insert a line break ourselves so no <div>s appear.
          e.preventDefault();
          document.execCommand('insertLineBreak');
        }
      }
      return;
    }
    if (a && a.mode === 'comment' && e.key === 'Escape') {
      e.preventDefault();
      this.endActive();
      return;
    }
    if (e.key === 'Escape' && this.pick && !a) {
      this.setPick(false);
      this.toast('Pick mode off — page behaves normally');
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const a = this.active;
    if (!a || a.mode !== 'edit' || this.isOwnEvent(e)) return;
    if (a.el.contains(e.target as Node) || document.activeElement === a.el) {
      e.stopPropagation();
      // Buttons activate on Space keyup; don't let that "click" through.
      if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    }
  };

  private onPanelKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      void this.copyPrompt();
    }
  }

  // -------------------------------------------------------------------------
  // Selection / editing

  private select(el: Element, x?: number, y?: number) {
    const mode: ChangeType = this.tab === 'comment' ? 'comment' : 'edit';
    if (this.active) {
      if (this.active.el === el && this.active.mode === mode) return;
      this.commitActive();
    }
    if (this.tab === 'browse') this.tab = 'edit';
    this.hover = null;
    const original = extractText(el);
    const existing = this.findChange(el, mode);
    this.active = {
      el,
      mode,
      original: existing ? { text: existing.originalText, segments: existing.segments } : original,
      restore: snapshot(el),
      attrs: {},
      draft: existing?.comment ?? '',
    };
    if (mode === 'edit') this.beginEditing(x, y);
    this.render();
    if (mode === 'comment') this.focusComment();
  }

  private beginEditing(x?: number, y?: number) {
    const a = this.active!;
    const el = a.el as HTMLElement;
    for (const attr of EDIT_ATTRS) a.attrs[attr] = el.getAttribute(attr);
    el.setAttribute('data-reword-editing', '');
    el.setAttribute('spellcheck', 'true');
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    // Links are draggable, which fights text selection while editing.
    const link = el.closest('a');
    if (link) {
      a.attrs['__draggable'] = link.getAttribute('draggable');
      link.setAttribute('draggable', 'false');
    }
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    let range: Range | null = null;
    if (x != null && y != null) {
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      const pos = doc.caretPositionFromPoint?.(x, y);
      if (pos && el.contains(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      } else {
        const r = document.caretRangeFromPoint?.(x, y);
        if (r && el.contains(r.startContainer)) range = r;
      }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
    } else {
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private stopEditing() {
    const a = this.active;
    if (!a) return;
    const el = a.el as HTMLElement;
    for (const attr of EDIT_ATTRS) {
      const v = a.attrs[attr];
      if (v == null) el.removeAttribute(attr);
      else el.setAttribute(attr, v);
    }
    if ('__draggable' in a.attrs) {
      const link = el.closest('a');
      const v = a.attrs['__draggable'];
      if (link) v == null ? link.removeAttribute('draggable') : link.setAttribute('draggable', v);
    }
    el.blur();
    window.getSelection()?.removeAllRanges();
  }

  private commitEdit() {
    const a = this.active;
    if (!a || a.mode !== 'edit') return;
    this.stopEditing();
    const newText = extractText(a.el).text;
    const existing = this.findChange(a.el, 'edit');
    if (existing) {
      if (newText === existing.originalText) this.removeChange(existing.id, false);
      else existing.newText = newText;
    } else if (newText !== a.original.text) {
      const change = this.createChange(a.el, 'edit', a.original, { newText });
      this.restores.set(change.id, a.restore);
    }
    this.active = null;
    this.persist();
    this.render();
  }

  private cancelEdit() {
    const a = this.active;
    if (!a || a.mode !== 'edit') return;
    this.stopEditing();
    a.restore();
    this.active = null;
    this.render();
  }

  private commitComment() {
    const a = this.active;
    if (!a || a.mode !== 'comment') return;
    const text = normalize(a.draft);
    const existing = this.findChange(a.el, 'comment');
    if (existing) {
      if (text) existing.comment = text;
      else this.removeChange(existing.id, false);
    } else if (text) {
      this.createChange(a.el, 'comment', a.original, { comment: text });
    }
    this.active = null;
    this.persist();
    this.render();
  }

  private commitActive() {
    if (this.active?.mode === 'edit') this.commitEdit();
    else if (this.active?.mode === 'comment') this.commitComment();
  }

  private endActive() {
    if (this.active?.mode === 'edit') return this.cancelEdit();
    this.active = null;
    this.render();
  }

  private walkUp() {
    const a = this.active;
    if (!a) return;
    const parent = pickableParent(a.el);
    if (!parent) return;
    if (a.mode === 'edit') this.cancelEdit();
    else this.active = null;
    this.select(parent);
  }

  // -------------------------------------------------------------------------
  // Change list

  private findChange(el: Element, type: ChangeType): Change | undefined {
    return this.changes.find((c) => c.type === type && this.refs.get(c.id) === el);
  }

  private createChange(el: Element, type: ChangeType, original: ExtractedText, extra: Partial<Change>): Change {
    const info = describe(el, (node) => {
      const edited = this.changes.find((c) => c.type === 'edit' && this.refs.get(c.id) === node);
      return edited ? edited.originalText : node.textContent ?? '';
    });
    const change: Change = {
      id: uid(),
      type,
      url: location.href.replace(/#.*$/, ''),
      pathname: location.pathname,
      pageTitle: document.title,
      selector: buildSelector(el),
      fallbackSelector: buildFallbackSelector(el),
      tag: el.tagName.toLowerCase(),
      role: info.role,
      label: info.label,
      context: info.context,
      originalText: original.text,
      newText: '',
      comment: '',
      segments: original.segments,
      sourceHints: sourceHints(el),
      createdAt: Date.now(),
      ...extra,
    };
    this.changes.push(change);
    this.refs.set(change.id, el);
    return change;
  }

  private removeChange(id: string, revert = true) {
    const change = this.changes.find((c) => c.id === id);
    if (!change) return;
    if (revert && change.type === 'edit') {
      const el = this.refs.get(id);
      const restore = this.restores.get(id);
      if (el?.isConnected && restore) restore();
    }
    this.changes = this.changes.filter((c) => c.id !== id);
    this.refs.delete(id);
    this.restores.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  private undo() {
    if (this.active) return this.endActive();
    const last = this.changes.at(-1);
    if (!last) return;
    this.removeChange(last.id);
    this.persist();
    this.render();
    this.toast(`Undid #${this.changes.length + 1}`);
  }

  private clear() {
    if (this.active) this.endActive();
    for (const c of this.changes.slice().reverse()) this.removeChange(c.id);
    this.persist();
    this.render();
  }

  private persist() {
    void this.store.save(this.changes).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Re-finding elements after SPA navigation / re-renders

  private checkUrl = () => {
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    if (this.active) this.active.mode === 'edit' ? this.cancelEdit() : this.endActive();
    this.refresh();
    this.render();
  };

  /** Throttled (not debounced) so constantly-animating pages still get refreshed. */
  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      const before = this.changes.map((c) => !!this.refs.get(c.id)).join();
      this.refresh();
      const after = this.changes.map((c) => !!this.refs.get(c.id)).join();
      if (before !== after) this.render();
    }, 300);
  }

  private onThisPage(c: Change) {
    try {
      const u = new URL(c.url);
      return u.origin === location.origin && u.pathname === location.pathname;
    } catch {
      return c.pathname === location.pathname;
    }
  }

  private refresh() {
    for (const c of this.changes) {
      if (!this.onThisPage(c)) {
        this.refs.set(c.id, null);
        continue;
      }
      const current = this.refs.get(c.id);
      if (current?.isConnected) continue;
      this.refs.set(c.id, this.relocate(c));
    }
  }

  private relocate(c: Change): Element | null {
    const texts = [c.newText, c.originalText].filter(Boolean);
    const probes = texts.map((t) => (t.split('\n')[0] ?? '').slice(0, 24));
    const matches = (el: Element | null) => {
      if (!el) return false;
      const raw = (el.textContent ?? '').replace(/\s+/g, ' ');
      return probes.some((p) => raw.includes(p)) && texts.includes(extractText(el).text);
    };
    for (const sel of [c.selector, c.fallbackSelector]) {
      const el = query(sel);
      if (matches(el)) return el;
    }
    // Last resort: same tag, same text anywhere on the page.
    for (const el of Array.from(document.getElementsByTagName(c.tag))) {
      if (!isOwnNode(el) && matches(el)) return el;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // On-page layer (hover box, edit ring, badges) — repositioned every frame

  private loop = () => {
    if (!this.isOpen) return;
    this.updateHover();
    this.drawLayer();
    this.raf = requestAnimationFrame(this.loop);
  };

  private updateHover() {
    if (!this.pointer.dirty) return;
    this.pointer.dirty = false;
    if (!this.pick) {
      this.hover = null;
      return;
    }
    const top = document.elementFromPoint(this.pointer.x, this.pointer.y);
    if (!top || isOwnNode(top)) {
      this.hover = null;
      return;
    }
    const el = pickAt(this.pointer.x, this.pointer.y);
    this.hover = el && el !== this.active?.el ? el : null;
  }

  /** Keyed node pool so badges/chips survive between frames (clicks need stable targets). */
  private pool = new Map<string, HTMLElement>();

  private node(key: string, make: () => HTMLElement): HTMLElement {
    let el = this.pool.get(key);
    if (!el) {
      el = make();
      this.pool.set(key, el);
    }
    this.seen.add(key);
    if (el.parentNode !== this.layer) this.layer.append(el);
    return el;
  }

  private seen = new Set<string>();

  private place(el: HTMLElement, cls: string, r: DOMRect, pad: number) {
    if (el.className !== cls) el.className = cls;
    el.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
  }

  private drawLayer() {
    this.seen.clear();
    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width || r.height ? r : null;
    };
    const box = (key: string, el: Element, cls: string, pad = 3) => {
      const r = rectOf(el);
      if (r) this.place(this.node(key, () => h('div')), `box ${cls}`, r, pad);
      return r;
    };
    const commentTab = this.tab === 'comment';

    if (this.highlightAll) {
      for (const c of this.changes) {
        const el = this.refs.get(c.id);
        if (el?.isConnected) box(`q:${c.id}`, el, `queued ${c.type}`, 4);
      }
    }

    if (this.hover) {
      const r = box('hover', this.hover, `hover${commentTab ? ' comment' : ''}`);
      if (r) {
        const existing = this.changes.findIndex((c) => this.refs.get(c.id) === this.hover);
        const label = `${this.hover.tagName.toLowerCase()} · ${commentTab ? 'click to comment' : 'click to edit'}${existing >= 0 ? ` · #${existing + 1}` : ''}`;
        const tip = this.node('tip', () => h('div'));
        tip.className = `tip${commentTab ? ' comment' : ''}`;
        if (tip.textContent !== label) tip.textContent = label;
        tip.style.left = `${Math.max(4, r.left - 3)}px`;
        tip.style.top = r.top > 28 ? `${r.top - 26}px` : `${r.bottom + 6}px`;
      }
    }

    const a = this.active;
    if (a && a.el.isConnected) {
      const r = box('active', a.el, a.mode === 'edit' ? 'edit' : 'select', 4);
      const parent = pickableParent(a.el);
      if (r && parent) {
        box('nested', a.el, 'nested', 6);
        const chip = this.node('chip', () => h('button', { class: 'parent-chip', title: 'Expand selection to the parent element', onclick: () => this.walkUp() }));
        const key = `${a.el.tagName}>${parent.tagName}`;
        if (chip.dataset.key !== key) {
          chip.dataset.key = key;
          chip.replaceChildren(h('span', { class: 'tag' }, a.el.tagName.toLowerCase()), '·', icon('up', 11), `parent ${parent.tagName.toLowerCase()}`);
        }
        chip.style.left = `${Math.max(4, r.left - 7)}px`;
        chip.style.top = r.top > 34 ? `${r.top - 32}px` : `${r.bottom + 10}px`;
      }
    }

    if (this.flash && this.flash.until > performance.now() && this.flash.el.isConnected) box(`flash:${this.flash.until}`, this.flash.el, 'flash', 6);

    // Numbered badges: top-right corner, just outside the text box.
    const perEl = new Map<Element, number>();
    this.changes.forEach((c, i) => {
      const el = this.refs.get(c.id);
      if (!el?.isConnected) return;
      const r = textRect(el);
      if (r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) return;
      const stack = perEl.get(el) ?? 0;
      perEl.set(el, stack + 1);
      const b = this.node(`b:${c.id}`, () => h('button', { class: `badge ${c.type}`, onclick: () => this.showInList(c.id) }));
      const num = String(i + 1);
      if (b.textContent !== num) {
        b.textContent = num;
        b.title = `#${num} ${c.type === 'edit' ? 'copy-edit' : 'comment'} — show in list`;
      }
      b.style.left = `${Math.min(innerWidth - 24, r.right + 4 + stack * 20)}px`;
      b.style.top = `${Math.max(2, r.top - 12)}px`;
    });

    for (const [key, el] of this.pool) {
      if (!this.seen.has(key)) {
        el.remove();
        // Keep the reusable singletons; drop per-change / one-off nodes.
        if (key.includes(':')) this.pool.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Panel

  private setTab(tab: Tab) {
    if (this.active && tab !== this.tab) this.commitActive();
    this.tab = tab;
    this.render();
  }

  private setPick(on: boolean) {
    this.pick = on;
    if (!on) this.hover = null;
    this.render();
  }

  private showInList(id: string) {
    this.selectedId = id;
    this.tab = 'browse';
    this.render();
    this.root?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private reveal(c: Change) {
    this.selectedId = c.id;
    const el = this.refs.get(c.id);
    if (el?.isConnected) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.flash = { el, until: performance.now() + 1400 };
    } else if (!this.onThisPage(c)) {
      this.toast('That change is on another page');
    } else {
      this.toast('Element not found on this page');
    }
    this.render();
  }

  private focusComment() {
    requestAnimationFrame(() => this.root?.querySelector('textarea')?.focus());
  }

  private toast(msg: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    const panelH = this.panel.getBoundingClientRect().height;
    this.toastEl.style.bottom = `${panelH + 28}px`;
    this.toastEl.style.transform = 'none';
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  private render() {
    if (!this.root) return;
    const n = this.changes.length;
    const tabBtn = (id: Tab, label: string, extra?: Node) =>
      h('button', { class: `tab ${this.tab === id ? 'on' : ''}`, onclick: () => this.setTab(id) }, label, extra ?? null);

    const head = h('div', { class: 'head' },
      h('div', { class: 'tabs', role: 'tablist' },
        tabBtn('edit', 'Edit copy'),
        tabBtn('comment', 'Comment'),
        tabBtn('browse', 'Browse', n ? h('span', { class: 'count' }, String(n)) : undefined)),
      h('button', { class: 'icon-btn', title: 'Close (changes are kept)', 'aria-label': 'Close', onclick: () => this.close() }, icon('x', 16)));

    const bar = h('div', { class: 'bar' },
      h('button', { class: `switch ${this.pick ? 'on' : ''}`, title: 'Pick mode: clicks select text instead of following links', onclick: () => this.setPick(!this.pick) },
        h('span', { class: 'track' }), 'Pick mode'),
      h('span', { class: 'spacer' }),
      h('button', { class: `link-btn ${this.highlightAll ? 'on' : ''}`, title: 'Outline every queued element', disabled: !n, onclick: () => { this.highlightAll = !this.highlightAll; this.render(); } }, 'Highlight all'),
      h('button', { class: 'link-btn', title: 'Undo last change', disabled: !n && !this.active, onclick: () => this.undo() }, 'Undo'));

    const body = h('div', { class: 'body' });
    if (this.tab === 'edit') this.renderEdit(body);
    else if (this.tab === 'comment') this.renderComment(body);
    else this.renderBrowse(body);

    const foot = h('div', { class: 'foot' },
      h('button', { class: 'btn ghost', disabled: !n, onclick: () => this.clear() }, 'Clear'),
      h('span', { class: 'spacer' }),
      this.opts.flavor ? h('span', { class: 'flavor' }, this.opts.flavor) : null,
      h('button', { class: 'btn primary', title: `Copy agent prompt (${MOD}+Shift+C)`, disabled: !n, onclick: () => void this.copyPrompt() },
        n ? `Copy prompt (${n})` : 'Copy prompt'));

    this.panel.replaceChildren(head, bar, body, foot);
  }

  private renderEdit(body: HTMLElement) {
    const a = this.active;
    if (a?.mode === 'edit') {
      body.append(h('div', { class: 'status' },
        h('b', null, `Editing <${a.el.tagName.toLowerCase()}>`), ' — ',
        h('span', { class: 'kbd' }, '↵'), ' save · ', h('span', { class: 'kbd' }, 'Esc'), ' revert · ',
        h('span', { class: 'kbd' }, '⇧↵'), ' line break'));
    } else {
      body.append(h('div', { class: 'helper' }, this.pick
        ? 'Click any text to edit it. Enter saves, Esc reverts.'
        : 'Pick mode is off — the page behaves normally. Turn it on to select text.'));
    }
    this.renderRecent(body);
    if (this.opts.siteToggle) {
      body.append(h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: this.siteEnabled, onchange: (e: Event) => this.setSiteEnabled((e.target as HTMLInputElement).checked) }),
        'Enable on this site (press ', h('span', { class: 'kbd' }, 'E'), ' to toggle, reopen after reload)'));
    }
  }

  private async setSiteEnabled(on: boolean) {
    this.siteEnabled = on;
    await this.opts.siteToggle?.set(on);
    this.toast(on ? `Enabled on ${location.hostname}` : `Disabled on ${location.hostname}`);
  }

  private renderComment(body: HTMLElement) {
    const a = this.active;
    if (!a || a.mode !== 'comment') {
      body.append(h('div', { class: 'helper' }, this.pick
        ? 'Click any text to leave a comment on it instead of rewriting it.'
        : 'Pick mode is off — turn it on to select text.'));
      this.renderRecent(body);
      return;
    }
    const ta = h('textarea', {
      placeholder: 'What should change here? (Enter saves, Shift+Enter for a new line)',
      value: a.draft,
      oninput: (e: Event) => { a.draft = (e.target as HTMLTextAreaElement).value; },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.commitComment();
          if (e.metaKey || e.ctrlKey) this.setPick(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.endActive();
        }
      },
    });
    body.append(
      h('div', { class: 'section-title' }, `Commenting on <${a.el.tagName.toLowerCase()}>`),
      h('div', { class: 'quote' }, truncate(a.original.text, 400)),
      ta,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => this.endActive() }, 'Cancel'),
        h('button', { class: 'btn amber', onclick: () => this.commitComment() }, 'Save comment')),
    );
  }

  private renderRecent(body: HTMLElement) {
    const n = this.changes.length;
    if (!n) return;
    const recent = this.changes.slice(-3).reverse();
    body.append(
      h('div', { class: 'section-title' }, 'Recent',
        h('button', { class: 'link-btn', onclick: () => this.setTab('browse') }, `All ${n} →`)),
      h('div', { class: 'list' }, ...recent.map((c) => this.renderItem(c, true))),
    );
  }

  private renderBrowse(body: HTMLElement) {
    if (!this.changes.length) {
      body.append(h('div', { class: 'empty' }, 'No changes yet. Edit or comment on some text first.'));
    } else {
      body.append(h('div', { class: 'list' }, ...this.changes.map((c) => this.renderItem(c, false))));
    }
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e: Event) => this.importFile(e) });
    body.append(h('div', { class: 'row' },
      file,
      h('button', { class: 'link-btn', onclick: () => file.click() }, 'Import JSON'),
      h('button', { class: 'link-btn', disabled: !this.changes.length, onclick: () => this.exportJSON() }, 'Export JSON')));
  }

  private renderItem(c: Change, compact: boolean) {
    const index = this.changes.indexOf(c) + 1;
    const el = this.refs.get(c.id);
    const here = this.onThisPage(c);
    const flag = !here
      ? h('span', { class: 'flag other', title: c.url }, c.pathname || '/')
      : !el?.isConnected ? h('span', { class: 'flag' }, 'element not found') : null;
    const del = h('button', {
      class: 'del', title: 'Remove', 'aria-label': 'Remove',
      onclick: (e: Event) => { e.stopPropagation(); this.removeChange(c.id); this.persist(); this.render(); },
    }, icon('trash', 13));
    const content: Node[] = [];
    if (c.type === 'edit') {
      content.push(h('div', { class: 'from' }, compact ? truncate(c.originalText, 90) : c.originalText));
      content.push(h('div', { class: 'to' }, compact ? truncate(c.newText, 90) : c.newText));
    } else {
      content.push(h('div', { class: 'visible' }, truncate(c.originalText, compact ? 70 : 160)));
      content.push(h('div', { class: 'note' }, compact ? truncate(c.comment, 90) : c.comment));
    }
    return h('div', {
      class: `item ${c.type} ${this.selectedId === c.id ? 'selected' : ''}`, 'data-id': c.id, onclick: () => this.reveal(c),
      title: compact ? '' : `${c.selector}`,
    },
      h('span', { class: 'num' }, String(index)),
      h('div', { class: 'meta' }, h('span', { class: 'type' }, c.type === 'edit' ? 'copy-edit' : 'comment'), h('span', { class: 'label' }, c.label), flag),
      ...content,
      compact ? null : h('div', { class: 'ctx', title: c.context }, `${c.context} · ${c.pathname}`),
      del);
  }

  private exportJSON() {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadText(`copy-edits-${location.hostname}-${stamp}.json`, JSON.stringify(toJSON(this.changes), null, 2));
  }

  private async importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = (Array.isArray(data) ? data : data?.changes) as Partial<Change>[];
      if (!Array.isArray(list)) throw new Error('not a list');
      let added = 0;
      for (const raw of list) {
        if (!raw || (raw.type !== 'edit' && raw.type !== 'comment') || typeof raw.originalText !== 'string') continue;
        const id = typeof raw.id === 'string' ? raw.id : uid();
        if (this.changes.some((c) => c.id === id)) continue;
        this.changes.push({
          id, type: raw.type, url: raw.url ?? location.href, pathname: raw.pathname ?? location.pathname, pageTitle: raw.pageTitle ?? document.title,
          selector: raw.selector ?? '', fallbackSelector: raw.fallbackSelector ?? '', tag: raw.tag ?? 'span', role: raw.role ?? '',
          label: raw.label ?? 'Text', context: raw.context ?? '', originalText: raw.originalText, newText: raw.newText ?? '', comment: raw.comment ?? '',
          segments: raw.segments ?? [], sourceHints: raw.sourceHints ?? [],
          createdAt: typeof raw.createdAt === 'string' ? Date.parse(raw.createdAt) || Date.now() : raw.createdAt ?? Date.now(),
        });
        added++;
      }
      this.refresh();
      this.persist();
      this.render();
      this.toast(`Imported ${added} change${added === 1 ? '' : 's'}`);
    } catch {
      this.toast('Could not read that file');
    }
  }
}
