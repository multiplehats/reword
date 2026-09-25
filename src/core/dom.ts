import { truncate } from './text';

export const HOST_TAG = 'reword-overlay';

const TEXT_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'LI', 'A', 'BUTTON', 'LABEL', 'SMALL', 'STRONG', 'EM', 'B', 'I',
  'FIGCAPTION', 'CAPTION', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'Q', 'CITE', 'SUMMARY', 'LEGEND', 'MARK', 'SUP', 'SUB',
  'TIME', 'ABBR', 'CODE', 'DIV', 'U', 'S', 'DEL', 'INS',
]);
const NEVER = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'MAIN', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'FORM',
]);
const MAX_TEXT = 1500;

export function isOwnNode(node: Node | null): boolean {
  if (!node) return false;
  const root = node.getRootNode();
  return (root instanceof ShadowRoot && root.host.tagName.toLowerCase() === HOST_TAG) ||
    (node instanceof Element && node.tagName.toLowerCase() === HOST_TAG);
}

function hasDirectText(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim()) return true;
  }
  return false;
}

function insideSvg(el: Element): boolean {
  return !!el.closest('svg');
}

/** An element whose copy we can edit or comment on. */
export function isPickable(el: Element): boolean {
  if (NEVER.has(el.tagName) || isOwnNode(el) || insideSvg(el)) return false;
  if ((el as HTMLElement).isContentEditable && !el.hasAttribute('data-reword-editing')) return false;
  if (el.closest('input, textarea, select, [contenteditable=""]:not([data-reword-editing]), [contenteditable="true"]:not([data-reword-editing])')) return false;
  const text = el.textContent?.trim() ?? '';
  if (!text || text.length > MAX_TEXT) return false;
  // A DIV only counts when it holds text directly (not just wrappers around other blocks).
  if (el.tagName === 'DIV') return hasDirectText(el);
  return TEXT_TAGS.has(el.tagName) || hasDirectText(el) || el.getAttribute('role') === 'button';
}

/** Walk up from a hit element to the nearest pickable one. */
export function closestPickable(start: Element | null): Element | null {
  let el: Element | null = start;
  while (el && el !== document.body) {
    if (isPickable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Resolve what's under the pointer. Uses `elementsFromPoint` so transparent
 * overlays (common on Framer/Webflow) don't hide the copy underneath.
 */
export function pickAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (isOwnNode(el)) continue;
    const hit = closestPickable(el);
    if (hit) return hit;
  }
  return null;
}

/** Parent that is worth expanding to (e.g. span → button). */
export function pickableParent(el: Element): Element | null {
  let p = el.parentElement;
  while (p && p !== document.body) {
    if (isPickable(p)) return p;
    p = p.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selectors

const GENERATED_ID = /^(?:[:_]?r[\d:]|radix-|headlessui-|mui-|ember\d|[\w-]*\d{4,}|[a-f0-9]{8,}$)/i;
const STABLE_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-framer-name', 'aria-label', 'name'];

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, (c) => `\\${c}`);
}

function stableId(el: Element): string | null {
  const id = el.id;
  return id && !GENERATED_ID.test(id) ? id : null;
}

function nthOfType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
}

function unique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function anchorFor(el: Element): string | null {
  const id = stableId(el);
  if (id) return `#${cssEscape(id)}`;
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v && v.length < 80) {
      const sel = `${el.tagName.toLowerCase()}[${attr}="${v.replace(/"/g, '\\"')}"]`;
      if (unique(sel)) return sel;
    }
  }
  return null;
}

/** Shortest selector anchored on a stable id/test attribute, falling back to a structural path. */
export function buildSelector(el: Element): string {
  const own = anchorFor(el);
  if (own) return own;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    const anchor = cur !== el ? anchorFor(cur) : null;
    if (anchor) {
      parts.unshift(anchor);
      break;
    }
    parts.unshift(cur === document.body ? 'body' : nthOfType(cur));
    if (cur === document.body) break;
    const candidate = parts.join(' > ');
    if (parts.length >= 3 && unique(candidate) && document.querySelector(candidate) === el) return candidate;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

/** Full structural path from <body>, ignoring ids. Survives id churn. */
export function buildFallbackSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    parts.unshift(nthOfType(cur));
    cur = cur.parentElement;
  }
  return ['body', ...parts].join(' > ');
}

export function query(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context

const HEADING = /^H[1-6]$/;

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  if (HEADING.test(el.tagName)) return 'heading';
  if (el.tagName === 'BUTTON' || el.closest('button, [role=button]')) return 'button';
  if (el.tagName === 'A' || el.closest('a[href]')) return 'link';
  if (el.tagName === 'LI') return 'listitem';
  return '';
}

export function kindOf(el: Element): string {
  const tag = el.tagName;
  if (HEADING.test(tag)) return tag === 'H1' ? 'Headline (H1)' : `Heading (${tag})`;
  const role = roleOf(el);
  if (role === 'button') return 'Button label';
  if (role === 'link') return 'Link text';
  if (tag === 'P') return 'Paragraph';
  if (tag === 'LI') return 'List item';
  if (tag === 'LABEL') return 'Label';
  if (tag === 'FIGCAPTION' || tag === 'CAPTION') return 'Caption';
  if (tag === 'BLOCKQUOTE' || tag === 'Q') return 'Quote';
  if (tag === 'SMALL') return 'Small print';
  if (/\b(?:badge|pill|chip|tag|eyebrow|kicker|label)\b/i.test(el.getAttribute('class') ?? '')) return 'Badge';
  return 'Text';
}

function sectionOf(el: Element): { el: Element; name: string } | null {
  const section = el.closest('section, header, footer, nav, aside, article, [id]:not(html):not(body), [aria-label]');
  if (!section || section === el) {
    const up = el.parentElement?.closest('section, header, footer, nav, aside, article');
    if (!up) return null;
    return { el: up, name: nameSection(up) };
  }
  return { el: section, name: nameSection(section) };
}

function nameSection(section: Element): string {
  const tag = section.tagName.toLowerCase();
  const id = stableId(section);
  if (id) return `${tag}#${id}`;
  const label = section.getAttribute('aria-label') || section.getAttribute('data-framer-name');
  if (label) return `${tag} “${truncate(label, 30)}”`;
  const cls = Array.from(section.classList).find((c) => /hero|pricing|feature|faq|cta|footer|header|testimonial|banner|nav/i.test(c));
  return cls ? `${tag}.${cls}` : tag;
}

/** Nearest heading before `el` in document order, within its section if possible. */
function nearestHeading(el: Element, scope: Element): Element | null {
  const headings = Array.from(scope.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  let best: Element | null = null;
  for (const h of headings) {
    if (h === el || h.contains(el)) continue;
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
  }
  return best ?? headings.find((h) => h !== el && !h.contains(el)) ?? null;
}

export interface ElementContext {
  label: string;
  context: string;
  role: string;
}

/**
 * @param textOf resolves an element's text; lets the overlay report the
 * original copy of a heading that has already been edited.
 */
export function describe(el: Element, textOf: (el: Element) => string = (e) => e.textContent ?? ''): ElementContext {
  const kind = kindOf(el);
  const section = sectionOf(el);
  const parts: string[] = [];
  if (section) parts.push(section.name);
  if (!HEADING.test(el.tagName)) {
    const h = nearestHeading(el, section?.el ?? document.body);
    const ht = h ? textOf(h).trim() : '';
    if (ht) parts.push(`under “${truncate(ht, 48)}”`);
  }
  const control = el.closest('a[href], button, [role=button]');
  if (control && control !== el) {
    const ct = textOf(control).trim();
    if (ct) parts.push(`inside ${control.tagName.toLowerCase()} “${truncate(ct, 40)}”`);
  }
  parts.push(`<${el.tagName.toLowerCase()}>`);
  let sectionHint = section?.name.match(/hero|pricing|feature|faq|cta|footer|header|nav|testimonial/i)?.[0]?.toLowerCase();
  // The block holding the page's first <h1> is the hero, whatever it's called.
  const firstH1 = document.querySelector('h1');
  if (!sectionHint && section && firstH1 && section.el.contains(firstH1) && section.el !== document.body) sectionHint = 'hero';
  return {
    label: sectionHint ? `${kind} — ${sectionHint}` : kind,
    context: parts.join(' › '),
    role: roleOf(el),
  };
}

const HINT_ATTRS = [
  'data-component', 'data-component-name', 'data-sentry-component', 'data-sentry-element', 'data-sentry-source-file',
  'data-source', 'data-source-file', 'data-inspector-relative-path', 'data-inspector-line', 'data-locator', 'data-lov-id',
  'data-v0-t', 'data-framer-name', 'data-framer-component-type', 'data-block', 'data-slot', 'data-testid',
];

/** Collect framework/devtool attributes that hint at the source component. */
export function sourceHints(el: Element): string[] {
  const hints: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.body && depth < 8; depth++, cur = cur.parentElement) {
    for (const attr of HINT_ATTRS) {
      const v = cur.getAttribute(attr);
      if (v && hints.length < 6) {
        const hint = `${attr}="${truncate(v, 80)}"`;
        if (!hints.includes(hint)) hints.push(hint);
      }
    }
  }
  return hints;
}

/** Tight box around the rendered text (block elements are often much wider than their copy). */
export function textRect(el: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width || r.height ? r : el.getBoundingClientRect();
}

// ---------------------------------------------------------------------------
// Snapshots: put a subtree back exactly as it was, reusing the original
// nodes so frameworks that hold references (React, Vue) don't get confused.

export function snapshot(root: Element): () => void {
  const children = new Map<Node, Node[]>();
  const data = new Map<Node, string>();
  const visit = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) data.set(n, n.nodeValue ?? '');
    const kids = Array.from(n.childNodes);
    children.set(n, kids);
    kids.forEach(visit);
  };
  visit(root);
  return () => {
    for (const [node, value] of data) if (node.nodeValue !== value) node.nodeValue = value;
    for (const [node, kids] of children) {
      const now = Array.from(node.childNodes);
      if (now.length !== kids.length || now.some((k, i) => k !== kids[i])) (node as Element).replaceChildren(...kids);
    }
  };
}
