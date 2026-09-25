import type { Change } from './types';

const INTRO =
  'Apply the following marketing copy updates. These were edited visually on the live page. Find the matching strings in the repo (marketing site / landing pages) and update them exactly. Do not change layout, styling, or nearby copy unless required to keep the string unique.';

const RULES = `Rules for the coding agent:
- Search the codebase for the original strings first.
- If an exact match fails, the string may be split across elements or encoded differently: search for each of the listed search terms, and try quote/entity variants (’ vs ' vs &apos; vs {"'"}, “ ” vs ", &amp; vs &, &nbsp;).
- If a string appears in multiple files, prefer the file that corresponds to this route/page.
- Keep existing interpolation, markdown, JSX structure, and translations in mind. If the string is split across elements, update the source so the rendered text matches the new copy.
- Do not invent extra copy rewrites.
- After edits, list every file you changed.`;

function block(text: string, indent: string): string {
  return [`${indent}"""`, ...text.split('\n').map((l) => `${indent}${l}`), `${indent}"""`].join('\n');
}

function describeChange(c: Change, n: number): string {
  const i = '   ';
  const lines = [`${n}. [${c.type.toUpperCase()}] ${c.label}`, `${i}Selector: ${c.selector}`, `${i}Context: ${c.context}`];
  if (c.sourceHints.length) lines.push(`${i}Source hints: ${c.sourceHints.join(', ')}`);
  if (c.segments.length > 1) lines.push(`${i}Search terms (text is split across elements): ${c.segments.map((s) => JSON.stringify(s)).join(', ')}`);
  if (c.type === 'edit') {
    lines.push(`${i}From:`, block(c.originalText, i), `${i}To:`, block(c.newText, i));
  } else {
    lines.push(`${i}Visible text:`, block(c.originalText, i), `${i}Comment:`, block(c.comment, i));
  }
  return lines.join('\n');
}

function groupByPage(changes: Change[]): Map<string, Change[]> {
  const pages = new Map<string, Change[]>();
  for (const c of changes) {
    const list = pages.get(c.url) ?? [];
    list.push(c);
    pages.set(c.url, list);
  }
  return pages;
}

export function toJSON(changes: Change[]) {
  return changes.map(({ id, type, url, pathname, selector, fallbackSelector, tag, role, label, context, originalText, newText, comment, segments, sourceHints, createdAt }) => ({
    id, type, url, pathname, selector, fallbackSelector, tag, role, label, context, originalText, newText, comment, segments, sourceHints,
    createdAt: new Date(createdAt).toISOString(),
  }));
}

export function buildPrompt(changes: Change[]): string {
  const pages = groupByPage(changes);
  const out: string[] = [INTRO, ''];
  for (const [url, list] of pages) {
    out.push(`Page: ${url}`, `Page title: ${list[0]?.pageTitle ?? ''}`, '', 'Changes:', '');
    // Numbers match the on-page badges.
    for (const c of list) out.push(describeChange(c, changes.indexOf(c) + 1), '');
  }
  out.push(RULES, '', 'Machine-readable version of the same changes:', '', '```json', JSON.stringify(toJSON(changes), null, 2), '```', '');
  return out.join('\n');
}
