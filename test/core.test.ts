import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, describe as describeEl, isPickable, snapshot } from '../src/core/dom';
import { buildPrompt } from '../src/core/prompt';
import { extractText, normalize } from '../src/core/text';
import type { Change } from '../src/core/types';

describe('normalize', () => {
  it('collapses spaces but keeps intentional line breaks', () => {
    expect(normalize('  Hello    world \n\n\n\n  second   line  ')).toBe('Hello world\n\nsecond line');
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
});

describe('dom helpers', () => {
  it('prefers stable ids and skips generated ones', () => {
    document.body.innerHTML = '<section id="pricing"><div id=":r3:"><p>Hi</p><p>There</p></div></section>';
    const p = document.querySelectorAll('p')[1]!;
    const sel = buildSelector(p);
    expect(sel.startsWith('#pricing')).toBe(true);
    expect(sel).not.toContain(':r3:');
    expect(document.querySelector(sel)).toBe(p);
  });

  it('does not pick form fields or structural wrappers', () => {
    document.body.innerHTML = '<section id="s"><input id="i" value="x"><p id="p">Copy</p></section>';
    expect(isPickable(document.getElementById('i')!)).toBe(false);
    expect(isPickable(document.getElementById('s')!)).toBe(false);
    expect(isPickable(document.getElementById('p')!)).toBe(true);
  });

  it('describes buttons with section and heading context', () => {
    document.body.innerHTML = '<section id="hero"><h1>Big idea</h1><button><span id="l">Book a demo</span></button></section>';
    const info = describeEl(document.getElementById('l')!);
    expect(info.label).toBe('Button label — hero');
    expect(info.context).toContain('section#hero');
    expect(info.context).toContain('under “Big idea”');
    expect(info.context).toContain('inside button “Book a demo”');
  });

  it('snapshot restores the original nodes after edits', () => {
    document.body.innerHTML = '<h1 id="h">Ship <span id="s">faster</span></h1>';
    const h = document.getElementById('h')!;
    const span = document.getElementById('s')!;
    const restore = snapshot(h);
    h.textContent = 'Totally different';
    restore();
    expect(h.innerHTML).toBe('Ship <span id="s">faster</span>');
    expect(h.querySelector('span')).toBe(span);
  });
});

describe('buildPrompt', () => {
  const base: Omit<Change, 'id' | 'type' | 'originalText' | 'newText' | 'comment'> = {
    url: 'https://example.com/', pathname: '/', pageTitle: 'Example', selector: 'h1', fallbackSelector: 'body > h1',
    tag: 'h1', role: 'heading', label: 'Headline (H1) — hero', context: 'section#hero › <h1>', segments: [], sourceHints: [], createdAt: 0,
  };

  it('renders edits and comments with numbering, rules, and JSON', () => {
    const prompt = buildPrompt([
      { ...base, id: 'a', type: 'edit', originalText: 'Old', newText: 'New', comment: '' },
      { ...base, id: 'b', type: 'comment', originalText: 'Para', newText: '', comment: 'Shorter', segments: ['Pa', 'ra'] },
    ]);
    expect(prompt).toContain('Page: https://example.com/');
    expect(prompt).toContain('1. [EDIT] Headline (H1) — hero');
    expect(prompt).toContain('   From:\n   """\n   Old\n   """\n   To:\n   """\n   New\n   """');
    expect(prompt).toContain('2. [COMMENT]');
    expect(prompt).toContain('Search terms (text is split across elements): "Pa", "ra"');
    expect(prompt).toContain('Rules for the coding agent:');
    const json = JSON.parse(prompt.split('```json')[1]!.split('```')[0]!);
    expect(json).toHaveLength(2);
    expect(json[1].comment).toBe('Shorter');
  });

  it('groups by page but keeps badge numbering', () => {
    const prompt = buildPrompt([
      { ...base, id: 'a', type: 'edit', originalText: 'A', newText: 'A2', comment: '' },
      { ...base, id: 'b', url: 'https://example.com/pricing', pathname: '/pricing', type: 'edit', originalText: 'B', newText: 'B2', comment: '' },
      { ...base, id: 'c', type: 'edit', originalText: 'C', newText: 'C2', comment: '' },
    ]);
    expect(prompt.indexOf('3. [EDIT]')).toBeLessThan(prompt.indexOf('Page: https://example.com/pricing'));
    expect(prompt).toContain('2. [EDIT]');
  });
});
