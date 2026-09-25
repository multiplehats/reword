// Builds the prompt the user pastes into their coding agent.
import { serialize, type Change } from "./changes";

/** JSON string syntax, so quotes and line breaks inside the copy stay unambiguous. */
const quote = (s: string) => JSON.stringify(s);
const code = (s: string) => "`" + s.replace(/`/g, "'") + "`";

const RULES = `Rules for the coding agent:
- Locate each element by searching the codebase for its old text first, then the selector, class names and source hints.
- If an exact text match fails, the copy may be split across elements or encoded differently: search for each listed search term, and try quote/entity variants (’ vs ' vs &apos; vs {"'"}, “ ” vs ", &amp; vs &, &nbsp;).
- If a string appears in several files, prefer the one that renders this page/route.
- EDIT TEXT: change only the copy. Keep interpolation, markup, JSX structure and translations intact. If the copy is split across elements, update the source so the rendered text matches.
- REMOVE and MOVE: change the markup in the component or template (delete or reorder the element), rather than hiding or repositioning it with CSS.
- NOTE: an instruction about that element; apply it.
- Don't make changes that weren't asked for. When you're done, list every file you changed.`;

function elementLines(c: Change): string[] {
  const lines = [`Element: <${c.tag}> — selector: ${code(c.selector)}`, `Section: ${c.section}`];
  if (c.sourceHints.length) lines.push(`Source hints: ${c.sourceHints.join(", ")}`);
  return lines;
}

const searchTerms = (c: Change) =>
  c.segments.length > 1 ? [`Search terms (text is split across elements): ${c.segments.map((s) => JSON.stringify(s)).join(", ")}`] : [];

function describe(c: Change): string[] {
  switch (c.type) {
    case "edit":
      return ["EDIT TEXT", ...elementLines(c), `Old: ${quote(c.oldText)}`, `New: ${quote(c.newText)}`, ...searchTerms(c), `Context HTML: ${code(c.contextHtml)}`];
    case "remove":
      return ["REMOVE", ...elementLines(c), ...(c.snippet ? [`Text: ${quote(c.snippet)}`] : []), `Context HTML: ${code(c.contextHtml)}`];
    case "note":
      return [
        "NOTE",
        ...elementLines(c),
        ...(c.snippet ? [`Text: ${quote(c.snippet)}`] : []),
        ...searchTerms(c),
        `Instruction: ${quote(c.note)}`,
        `Context HTML: ${code(c.contextHtml)}`,
      ];
    case "move": {
      const a = c.snippet ? ` (${quote(c.snippet)})` : "";
      const b = c.targetSnippet ? ` (${quote(c.targetSnippet)})` : "";
      const from = c.fromParentSelector ?? c.parentSelector;
      const line =
        from === c.parentSelector
          ? `Move ${code(c.selector)}${a} to be ${c.position} ${code(c.targetSelector)}${b} within ${code(c.parentSelector)}.`
          : `Move ${code(c.selector)}${a} out of ${code(from)} to be ${c.position} ${code(c.targetSelector)}${b} in ${code(c.parentSelector)}.`;
      return ["MOVE", line, `Section: ${c.section}`, ...(c.sourceHints.length ? [`Source hints: ${c.sourceHints.join(", ")}`] : []), `Context HTML: ${code(c.contextHtml)}`];
    }
  }
}

function numbered(c: Change, n: number): string[] {
  const [title, ...rest] = describe(c);
  const prefix = `${n}. `;
  return [`${prefix}${title}`, ...rest.map((l) => " ".repeat(prefix.length) + l), ""];
}

const pageLine = (url: string, title: string) => `Page: ${url}  |  Title: ${title || "(untitled)"}`;

/** The change list as JSON, without runtime fields, for agents that prefer structured input. */
export function toJSON(changes: Change[]) {
  return changes.map((c, i) => ({ number: i + 1, ...serialize(c) }));
}

/** Changes are numbered in list order, which is grouped by page; numbers match the panel. */
export function buildPrompt(changes: Change[]): string {
  const viewport = `Viewport: ${window.innerWidth}x${window.innerHeight}`;
  const pages = new Map<string, Change["page"]>();
  for (const c of changes) if (!pages.has(c.page.key)) pages.set(c.page.key, c.page);
  const tail = [RULES, "", "Machine-readable version of the same changes:", "", "```json", JSON.stringify(toJSON(changes), null, 2), "```", ""];

  if (pages.size <= 1) {
    const page = [...pages.values()][0] ?? { url: location.href, title: document.title };
    const header = [
      "I reviewed the live page and want these changes applied to the source code.",
      `${pageLine(page.url, page.title)}  |  ${viewport}`,
    ];
    if (!changes.length) return [...header, "", "(No changes yet.)"].join("\n");
    return [...header, "", ...changes.flatMap((c, i) => numbered(c, i + 1)), ...tail].join("\n");
  }

  const lines = [
    `I reviewed ${pages.size} pages of the live site and want these changes applied to the source code.`,
    `Site: ${location.origin}  |  ${viewport}`,
    "",
  ];
  let n = 0;
  for (const page of pages.values()) {
    lines.push(`## ${pageLine(page.url, page.title)}`, "");
    for (const c of changes.filter((c) => c.page.key === page.key)) lines.push(...numbered(c, ++n));
  }
  return [...lines, ...tail].join("\n");
}
