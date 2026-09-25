// End-to-end check of the acceptance flow against test/fixture.html, run twice:
// once through the real MV3 extension, once through the bookmarklet bundle.
// Run `pnpm build` first. Screenshots and the copied prompt land in test/.e2e/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const EXT = path.join(root, '.output/chrome-mv3');
const FIXTURE = fs.readFileSync(path.join(root, 'test/fixture.html'), 'utf8');
fs.mkdirSync(path.join(root, 'test/.e2e'), { recursive: true });
const out = (f) => path.join(root, 'test/.e2e', f);
const assert = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };

async function withFixture(ctx) {
  await ctx.route('http://localhost:4599/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURE }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:4599/');
  await page.waitForTimeout(500);
  return page;
}

async function scenario(page, open, getPrompt) {
  await open();
  await page.waitForTimeout(300);
  const ov = (s) => page.locator(`reword-overlay ${s}`);

  // Nested: span inside button → chip → walk up to the button.
  await page.locator('#cta span').click();
  await page.waitForTimeout(150);
  const chip = await ov('.parent-chip').textContent().catch(() => null);
  assert(chip && chip.includes('span') && chip.includes('button'), `parent chip shown: "${chip}"`);
  await ov('.parent-chip').click();
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => document.querySelector('[data-reword-editing]')?.id) === 'cta', 'walked up to <button>');
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Get a demo now');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert(!(await page.evaluate(() => window.__submitted)), 'form not submitted by Enter/click');
  const bt = await page.locator('#cta').evaluate(e => e.innerHTML); assert(bt.includes('Get a demo now'), 'button text updated: ' + bt);

  // Uppercase badge reads source casing.
  await page.locator('#badge').click();
  await page.keyboard.press('End');
  await page.keyboard.type('s');
  await page.keyboard.press('Enter');

  // Esc reverts.
  await page.locator('h2').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Nope');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert((await page.locator('h2').textContent()) === 'Simple pricing', 'Esc reverted h2');

  // Split heading + line-break paragraph.
  await page.locator('h1 .grad').click();
  await page.waitForTimeout(100);
  const chip2 = await ov('.parent-chip').textContent().catch(() => null);
  assert(chip2 && chip2.includes('h1'), `chip offers h1: "${chip2}"`);
  await ov('.parent-chip').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Ship it with Acme');
  await page.keyboard.press('Meta+Enter');

  // Link text with pick mode on: no navigation / onclick.
  await page.locator('#pricing-link').click();
  await page.waitForTimeout(100);
  assert(!(await page.evaluate(() => window.__linkClicked)), 'link onclick swallowed in pick mode');
  await page.keyboard.press('Escape'); // revert this edit
  await page.keyboard.press('Escape'); // nothing active → pick mode off
  await page.waitForTimeout(100);
  await page.locator('#pricing-link').click();
  assert(await page.evaluate(() => window.__linkClicked), 'pick mode off → link works normally');
  await ov('.switch').click();

  // Comment on li.
  await ov('.tab:has-text("Comment")').click();
  await page.locator('li').first().click();
  await ov('textarea').fill('Say "unlimited team members" instead?');
  await ov('textarea').press('Enter');

  // Undo last (the comment), then re-add.
  await page.waitForTimeout(150);
  const before = await ov('.badge').count();
  await ov('.link-btn:has-text("Undo")').click();
  await page.waitForTimeout(150);
  const after = await ov('.badge').count(); assert(after === before - 1, 'undo removed one item ' + before + '->' + after);
  await page.locator('li').first().click();
  await ov('textarea').fill('Say "unlimited team members" instead?');
  await ov('textarea').press('Enter');

  await ov('.tab:has-text("Browse")').click();
  await page.waitForTimeout(200);
  const prompt = await getPrompt();
  return prompt;
}

{
  // --- Extension ---
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], permissions: ['clipboard-read', 'clipboard-write'],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const page = await withFixture(ctx);
  const prompt = await scenario(page,
    () => sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await chrome.tabs.sendMessage(t.id, { type: 'reword:toggle' }); }),
    async () => { await page.locator('reword-overlay .btn.primary').click(); await page.waitForTimeout(200); return page.evaluate(() => navigator.clipboard.readText()); });
  await page.screenshot({ path: out('fixture.png') });
  fs.writeFileSync(out('fixture-prompt.md'), prompt);
  assert(prompt.includes('New feature') && !prompt.includes('NEW FEATURE'), 'badge original uses source casing');
  assert(prompt.includes('"Ship", "faster", "with Acme"'), 'split heading search terms');
  assert(!prompt.includes('opens pricing'), 'sr-only text excluded');

  // SPA navigation: other route hides badges and flags items; coming back re-finds re-rendered nodes.
  await page.evaluate(() => history.pushState({}, '', '/pricing'));
  await page.waitForTimeout(800);
  assert((await page.locator('reword-overlay .badge').count()) === 0, 'no badges on another route');
  assert((await page.locator('reword-overlay .flag.other').count()) === 4, 'items flagged as other page');
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    const h1 = document.querySelector('h1');
    h1.replaceWith(h1.cloneNode(true)); // simulate a framework re-render
  });
  await page.waitForTimeout(1000);
  assert((await page.locator('reword-overlay .badge').count()) === 4, 'badges re-found after route change + re-render');

  // Toolbar fallback: re-injecting the content script must not create a second overlay.
  await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['/content-scripts/content.js'] });
  });
  await page.waitForTimeout(300);
  assert((await page.locator('reword-overlay').count()) === 1, 're-injection keeps a single overlay');

  // Persistence: reload keeps overlay open and queue intact.
  await page.reload();
  await page.waitForTimeout(800);
  assert(await page.locator('reword-overlay .panel').isVisible(), 'overlay reopened after reload');
  const badges = await page.locator('reword-overlay .badge').allTextContents();
  console.log('badges after reload:', badges);
  await page.screenshot({ path: out('fixture-reload.png') });
  await ctx.close();

  // --- Bookmarklet flavour (no extension) ---
  const b = await chromium.launch({ headless: true });
  const bctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const bpage = await withFixture(bctx);
  const code = fs.readFileSync(path.join(root, 'dist/reword.js'), 'utf8');
  const bm = fs.readFileSync(path.join(root, 'dist/bookmarklet.txt'), 'utf8').trim();
  assert(decodeURIComponent(bm.slice('javascript:'.length)) === code.trim(), 'bookmarklet decodes to reword.js');
  const bprompt = await scenario(bpage, () => bpage.evaluate(code), () => bpage.evaluate(() => window.Reword.getPrompt()));
  assert(bprompt.split('[EDIT]').length - 1 >= 3 && bprompt.includes('[COMMENT]'), 'bookmarklet prompt has edits + comment');
  await bpage.evaluate(code); // second click toggles closed
  assert(!(await bpage.locator('reword-overlay').count()), 'bookmarklet toggles closed');
  await b.close();
}
