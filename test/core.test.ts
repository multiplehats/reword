import { beforeEach, describe, expect, it } from 'vitest';
import type { Change, EditChange } from '../src/core/changes';
import { executeCommand } from '../src/core/commands';
import { getToolDefinitions } from '../src/core/definitions';
import { segmentsOf, sourceHints, stableSelector, textOf } from '../src/core/describe';
import { buildPrompt } from '../src/core/prompt';
import { store } from '../src/core/store';
import { extractText, normalize } from '../src/core/text';

describe('normalize', () => {
  it('collapses spaces but keeps intentional line breaks', () => {
    expect(normalize('  Hello    world \n\n\n\n  second   line  ')).toBe('Hello world\n\nsecond line');
  });
  it('strips zero-width characters', () => {
    expect(normalize('Book​ a demo')).toBe('Book a demo');
  });
});

describe('extractText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads source text, turning <br> into newlines and splitting segments', () => {
    document.body.innerHTML = '<h1 id="t">Ship <span>faster</span>\n    with Acme<br>today</h1>';
    const { text, segments } = extractText(document.getElementById('t')!);
    expect(text).toBe('Ship faster with Acme\ntoday');
    expect(segments).toEqual(['Ship', 'faster', 'with Acme', 'today']);
  });

  it('ignores script, svg and [hidden] content', () => {
    document.body.innerHTML = '<button id="b"><svg><text>icon</text></svg><span hidden>x</span>Book a demo<script>1</script></button>';
    expect(extractText(document.getElementById('b')!).text).toBe('Book a demo');
  });

  it('ignores text-transform', () => {
    document.body.innerHTML = '<span id="b" style="text-transform: uppercase">New feature</span>';
    expect(textOf(document.getElementById('b')!)).toBe('New feature');
  });
});

describe('describe helpers', () => {
  it('prefers stable ids and skips generated ones', () => {
    document.body.innerHTML = '<section id="pricing"><div id=":r3:"><p>Hi</p><p>There</p></div></section>';
    const p = document.querySelectorAll('p')[1]!;
    const sel = stableSelector(p, { cache: false });
    expect(sel.startsWith('#pricing')).toBe(true);
    expect(sel).not.toContain(':r3:');
    expect(document.querySelector(sel)).toBe(p);
  });

  it('collects source hints from ancestors and split segments', () => {
    document.body.innerHTML = '<div data-component="Hero"><h1 id="h" data-sentry-source-file="hero.tsx">Ship <span>faster</span></h1></div>';
    const h1 = document.getElementById('h')!;
    expect(sourceHints(h1)).toEqual(['data-sentry-source-file="hero.tsx"', 'data-component="Hero"']);
    expect(segmentsOf(h1)).toEqual(['Ship', 'faster']);
    expect(segmentsOf(h1.querySelector('span')!)).toEqual([]);
  });
});

describe('commands', () => {
  beforeEach(async () => {
    await executeCommand('clear_all');
    document.body.innerHTML =
      '<section id="hero"><h1 id="h">Ship <span>faster</span></h1><button id="b"><svg></svg>Book a demo</button></section><ul id="l"><li>One</li><li>Two</li></ul>';
  });

  // happy-dom has no layout, so look elements up by selector (text search skips invisible elements).
  const idFor = async (selector: string) => {
    const r = await executeCommand('find_elements', { selector });
    return (r.data as { elementId: string }[])[0]!.elementId;
  };

  it('edits text live, keeps icons, and undoes', async () => {
    const id = await idFor('#b');
    const res = await executeCommand('edit_text', { elementId: id, newText: 'Get a demo' });
    expect(res).toMatchObject({ ok: true, data: { changed: true, oldText: 'Book a demo' } });
    expect(document.getElementById('b')!.innerHTML).toBe('<svg></svg>Get a demo');
    await executeCommand('undo');
    expect(document.getElementById('b')!.textContent).toBe('Book a demo');
    expect(store.get().changes).toHaveLength(0);
  });

  it('collapses repeated edits and drops edits back to the original', async () => {
    const id = await idFor('#b');
    await executeCommand('edit_text', { elementId: id, newText: 'A' });
    await executeCommand('edit_text', { elementId: id, newText: 'B' });
    expect(store.get().changes).toHaveLength(1);
    expect((store.get().changes[0] as EditChange).oldText).toBe('Book a demo');
    await executeCommand('edit_text', { elementId: id, newText: 'Book a demo' });
    expect(store.get().changes).toHaveLength(0);
  });

  it('records split-text segments on edits', async () => {
    const id = await idFor('#h');
    await executeCommand('edit_text', { elementId: id, newText: 'Ship it' });
    expect(store.get().changes[0]!.segments).toEqual(['Ship', 'faster']);
  });

  it('moves, removes and notes', async () => {
    const two = await idFor('li:nth-of-type(2)');
    const one = await idFor('li:nth-of-type(1)');
    await executeCommand('move_element', { elementId: two, targetId: one, position: 'before' });
    expect(document.getElementById('l')!.textContent).toBe('TwoOne');
    await executeCommand('remove_element', { elementId: one });
    expect((document.querySelectorAll('li')[1] as HTMLElement).style.display).toBe('none');
    const note = await executeCommand('add_note', { elementId: two, note: 'Make this bold' });
    expect(note.ok).toBe(true);
    expect(store.get().changes.map((c) => c.type)).toEqual(['move', 'remove', 'note']);
    await executeCommand('clear_all');
    expect(document.getElementById('l')!.textContent).toBe('OneTwo');
    expect((document.querySelectorAll('li')[1] as HTMLElement).getAttribute('style')).toBeNull();
  });

  it('selects the parent of a nested element', async () => {
    const span = await idFor('#h span');
    await executeCommand('select_element', { elementId: span });
    const res = await executeCommand('select_parent', {});
    expect(res.data).toMatchObject({ tag: 'h1' });
  });

  it('validates params and never throws', async () => {
    expect(await executeCommand('edit_text', { elementId: 'el_1' })).toMatchObject({ ok: false, error: 'params.newText is required' });
    expect(await executeCommand('nope')).toMatchObject({ ok: false });
    expect(await executeCommand('remove_element', { elementId: 'el_99999' })).toMatchObject({ ok: false });
  });

  it('exposes tool definitions in both formats', () => {
    const tools = getToolDefinitions();
    expect(tools.map((t) => t.name)).toContain('edit_text');
    expect(getToolDefinitions('openai')[0]).toHaveProperty('function.parameters');
  });
});

describe('buildPrompt', () => {
  const page = { key: 'https://example.com/', url: 'https://example.com/', title: 'Example' };
  const base = {
    page, elementId: null, selector: 'h1', tag: 'h1', section: 'Hero', snippet: 'Old', contextHtml: '<h1>Old</h1>', segments: [], sourceHints: [],
  };

  it('renders every change type with rules and JSON', () => {
    const changes: Change[] = [
      { ...base, id: 'ch_1', type: 'edit', oldText: 'Old', newText: 'New', segments: ['Ol', 'd'], sourceHints: ['data-component="Hero"'] },
      { ...base, id: 'ch_2', type: 'note', note: 'Shorter' },
      { ...base, id: 'ch_3', type: 'remove' },
      {
        ...base, id: 'ch_4', type: 'move', position: 'after', targetId: null, targetSelector: 'li:nth-of-type(2)', targetSnippet: 'Two', parentSelector: 'ul', fromParentSelector: 'ul',
      },
    ];
    const prompt = buildPrompt(changes);
    expect(prompt).toContain('Page: https://example.com/  |  Title: Example');
    expect(prompt).toContain('1. EDIT TEXT\n   Element: <h1> — selector: `h1`');
    expect(prompt).toContain('   Old: "Old"\n   New: "New"');
    expect(prompt).toContain('Search terms (text is split across elements): "Ol", "d"');
    expect(prompt).toContain('Source hints: data-component="Hero"');
    expect(prompt).toContain('2. NOTE');
    expect(prompt).toContain('Instruction: "Shorter"');
    expect(prompt).toContain('3. REMOVE');
    expect(prompt).toContain('Move `h1` ("Old") to be after `li:nth-of-type(2)` ("Two") within `ul`.');
    expect(prompt).toContain('Rules for the coding agent:');
    const json = JSON.parse(prompt.split('```json')[1]!.split('```')[0]!);
    expect(json).toHaveLength(4);
    expect(json[0]).not.toHaveProperty('elementId');
    expect(json[1]).toMatchObject({ number: 2, note: 'Shorter' });
  });

  it('groups by page and keeps numbering across pages', () => {
    const other = { key: 'https://example.com/pricing', url: 'https://example.com/pricing', title: 'Pricing' };
    const prompt = buildPrompt([
      { ...base, id: 'ch_1', type: 'edit', oldText: 'A', newText: 'A2' },
      { ...base, id: 'ch_2', type: 'edit', oldText: 'C', newText: 'C2' },
      { ...base, id: 'ch_3', page: other, type: 'edit', oldText: 'B', newText: 'B2' },
    ]);
    expect(prompt).toContain('I reviewed 2 pages');
    expect(prompt.indexOf('2. EDIT TEXT')).toBeLessThan(prompt.indexOf('## Page: https://example.com/pricing'));
    expect(prompt.indexOf('3. EDIT TEXT')).toBeGreaterThan(prompt.indexOf('## Page: https://example.com/pricing'));
  });
});
