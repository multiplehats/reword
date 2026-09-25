// The Shadow DOM host. Page CSS can't reach inside, and our CSS can't leak out.
// Everything is built with createElement and styled with a constructable
// stylesheet (no innerHTML, no <style>), so it survives Trusted Types and strict CSP.
import { HOST_TAG } from "../describe";
import { CSS_TEXT } from "./styles";

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

export function ensureRoot(): ShadowRoot {
  if (root && host) return root;
  host = document.createElement(HOST_TAG);
  root = host.attachShadow({ mode: "open" });
  adoptStyles(root, CSS_TEXT);
  // Keep our UI's events from reaching the page's own bubble-phase handlers.
  for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "input", "wheel", "focusin", "focusout", "contextmenu"]) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  return root;
}

function adoptStyles(shadowRoot: ShadowRoot, css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    shadowRoot.append(style);
  }
}

export function mountHost() {
  ensureRoot();
  if (!host!.isConnected) document.documentElement.appendChild(host!);
}

export function unmountHost() {
  host?.remove();
}

export const shadow = () => root;

/** True if the event originated inside Reword's UI. */
export function isOurEvent(e: Event): boolean {
  return !!host && e.composedPath().includes(host);
}

export function isHost(el: Element | null): boolean {
  return !!el && el === host;
}

type Child = Node | string | null | undefined | false;

/** Tiny element builder. No innerHTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A <kbd> chip. */
export const kbd = (text: string) => h("kbd", {}, text);

// ---- Icons (16×16 grid) ----------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
type Shape = [tag: "path" | "rect" | "circle", attrs: Record<string, string | number>];
interface IconSpec {
  size?: number;
  /** Stroked icons; filled ones set fill per shape. */
  stroke?: number;
  cap?: boolean;
  fill?: boolean;
  shapes: Shape[];
}

const p = (d: string): Shape => ["path", { d }];
const dot = (cx: number, cy: number): Shape => ["circle", { cx, cy, r: 1.3 }];

const ICON_SPECS = {
  mark: {
    shapes: [
      ["rect", { width: 16, height: 16, rx: 4.5, class: "i-bg" }],
      ["path", { d: "M5 3.8v8l2.1-2 1.5 3 1.2-.6-1.5-2.9h2.9z", class: "i-ink" }],
      ["circle", { cx: 11.6, cy: 4.6, r: 1.5, class: "i-accent" }],
    ],
    size: 16,
  },
  warn: { stroke: 1.6, cap: true, shapes: [p("M8 2.5 14 13H2z"), p("M8 6.5v3M8 11.5v.01")] },
  check: { stroke: 1.8, cap: true, shapes: [p("m3.5 8.5 3 3 6-7")] },
  move: { stroke: 1.6, cap: true, shapes: [p("M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5")] },
  drag: { fill: true, shapes: [dot(5.5, 3.5), dot(10.5, 3.5), dot(5.5, 8), dot(10.5, 8), dot(5.5, 12.5), dot(10.5, 12.5)] },
  edit: { stroke: 1.6, cap: true, shapes: [p("M3 4h10M8 4v9M5.5 13h5")] },
  remove: { stroke: 1.6, cap: true, shapes: [p("M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5")] },
  note: { stroke: 1.6, shapes: [p("M3 2.5h10v8l-3 3H3z"), p("M10 13.5v-3h3")] },
  parent: { stroke: 1.6, cap: true, shapes: [p("M8 13V3.5M4 7.5l4-4 4 4")] },
  undo: { stroke: 1.6, cap: true, shapes: [p("M5.5 3 2.5 6l3 3"), p("M2.5 6H10a3.5 3.5 0 0 1 0 7H7")] },
  redo: { stroke: 1.6, cap: true, shapes: [p("M10.5 3l3 3-3 3"), p("M13.5 6H6a3.5 3.5 0 0 0 0 7h3")] },
  chevron: { stroke: 1.8, cap: true, shapes: [p("m4 6 4 4 4-4")] },
  close: { stroke: 1.8, cap: true, size: 12, shapes: [p("m4 4 8 8M12 4l-8 8")] },
  copy: {
    stroke: 1.6,
    shapes: [
      ["rect", { x: 5, y: 5, width: 8.5, height: 8.5, rx: 1.5 }],
      p("M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"),
    ],
  },
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICON_SPECS;

export function icon(name: IconName): SVGSVGElement {
  const spec: IconSpec = ICON_SPECS[name];
  const size = String(spec.size ?? 14);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  if (spec.fill) svg.setAttribute("fill", "currentColor");
  else if (spec.stroke) {
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", String(spec.stroke));
    svg.setAttribute("stroke-linejoin", "round");
    if (spec.cap) svg.setAttribute("stroke-linecap", "round");
  }
  for (const [tag, attrs] of spec.shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
    svg.append(shape);
  }
  return svg;
}

// ---- Clipboard -------------------------------------------------------------

/** Copies text, falling back to execCommand when the async Clipboard API is unavailable (no focus/gesture). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = ta.style.left = "0";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  const container = root ?? document.body;
  container.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  active?.focus?.({ preventScroll: true });
  if (!ok) throw new Error("Clipboard is not available on this page");
}
