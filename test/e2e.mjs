// End-to-end check against test/fixture.html, run twice: once through the real
// MV3 extension, once through the bookmarklet bundle.
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
const MOD = 'ControlOrMeta';

// Enforced on the bookmarklet run, which executes in the page's own world.
const STRICT_CSP = "require-trusted-types-for 'script'; style-src 'nonce-e2e'";

async function withFixture(ctx, { csp } = {}) {
  const headers = csp ? { 'Content-Security-Policy': csp } : {};
  await ctx.route('http://localhost:4599/**', (r) => r.fulfill({ contentType: 'text/html', headers, body: FIXTURE }));
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective}: ${e.sample || e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:4599/');
  await page.waitForTimeout(500);
  return page;
}

const ui = (page) => (s) => page.locator(`reword-overlay ${s}`);
const text = (page, sel) => page.locator(sel).evaluate((e) => e.textContent);

async function scenario(page, open, getPrompt) {
  await open();
  await page.waitForTimeout(300);
  const ov = ui(page);
  assert(await ov('.panel').isVisible(), 'panel shown');

  // Clicked too deep: span inside the button → parent button in the action bar widens it.
  await page.locator('#cta span').click();
  await page.waitForTimeout(100);
  const parent = await ov('.bar .parent').textContent();
  assert(parent === 'button', `parent button offers <button>: "${parent}"`);
  await ov('.bar .parent').click();
  await ov('.bar .edit').click();
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type('Get a demo now');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert(!(await page.evaluate(() => window.__submitted)), 'form not submitted by click/Enter');
  const bt = await page.locator('#cta').evaluate((e) => e.innerHTML);
  assert(bt.includes('Get a demo now') && bt.includes('<svg'), 'button text updated, icon kept: ' + bt);

  // Uppercase badge: double-click edits; the change reads in source casing.
  await page.locator('#badge').dblclick();
  await page.keyboard.press('End');
  await page.keyboard.type('s');
  await page.keyboard.press('Enter');

  // Esc cancels an edit.
  await page.locator('h2').dblclick();
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type('Nope');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert((await text(page, 'h2')) === 'Simple pricing', 'Esc cancelled h2 edit');

  // Split heading: select the span, widen to the h1, edit.
  await page.locator('h1 .grad').click();
  await page.waitForTimeout(100);
  assert((await ov('.bar .parent').textContent()) === 'h1', 'parent button offers <h1>');
  await ov('.bar .parent').click();
  await ov('.bar .edit').click();
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type('Ship it with Acme');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert((await text(page, 'h1')) === 'Ship it with Acme', 'h1 updated');

  // Links: a click selects, it doesn't navigate or run onclick. Alt+click uses the page.
  await page.locator('#pricing-link').click();
  await page.waitForTimeout(100);
  assert(!(await page.evaluate(() => window.__linkClicked)), 'link onclick swallowed');
  await page.keyboard.down('Alt');
  await page.locator('#pricing-link').click();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.__linkClicked), 'Alt+click reaches the page');
  await page.keyboard.press('Escape');

  // Note on the first list item.
  await page.locator('li').first().click();
  await ov('.bar .note').click();
  await ov('.note-editor textarea').fill('Say "unlimited team members" instead?');
  await ov('.note-editor textarea').press(`${MOD}+Enter`);
  await page.waitForTimeout(150);
  assert((await ov('.pin').count()) === 1, 'note pin shown');

  // Undo removes the note, redo brings it back.
  await ov('.panel .tools button:has-text("Undo")').click();
  await page.waitForTimeout(150);
  assert((await ov('.pin').count()) === 0, 'undo removed the note');
  await ov('.panel .tools button:has-text("Redo")').click();
  await page.waitForTimeout(150);
  assert((await ov('.pin').count()) === 1, 'redo restored the note');

  // Move: keyboard reorder via the drag handle.
  await page.locator('li').nth(1).click();
  await ov('.bar .handle').focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  assert((await page.locator('li').first().textContent()) === 'SOC 2 Type II', 'arrow key moved the item up');

  // Move: drag the figure above the list.
  await page.locator('figcaption').click();
  await ov('.bar .parent').click(); // figcaption → figure
  const handle = await ov('.bar .handle').boundingBox();
  const list = await page.locator('#pricing ul').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(list.x + 40, list.y + 4, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const order = await page.locator('#pricing').evaluate((s) => Array.from(s.children).map((c) => c.localName).join(','));
  assert(order === 'h2,figure,ul,div', 'drag moved the figure above the list: ' + order);

  // An empty full-card link (Framer/Webflow style) doesn't hide the copy under it.
  await page.locator('#card-copy').click({ force: true });
  await ov('.bar .edit').click();
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type('Trusted by 5,000 teams');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert((await text(page, '#card-copy')) === 'Trusted by 5,000 teams', 'copy under an empty link layer is editable');

  // Remove the h2.
  await page.locator('h2').click();
  await ov('.bar .danger').click();
  await page.waitForTimeout(100);
  assert(!(await page.locator('h2').isVisible()), 'h2 hidden by remove');

  assert((await ov('.item').count()) === 8, `8 changes listed (${await ov('.item').count()})`);
  return getPrompt();
}

function checkPrompt(prompt, label) {
  assert(prompt.includes('Old: "New feature"') && prompt.includes('New: "New features"') && !prompt.includes('NEW FEATURE'), `${label}: badge uses source casing`);
  assert(prompt.includes('"Ship", "faster", "with Acme"'), `${label}: split heading search terms`);
  assert(!prompt.includes('opens pricing'), `${label}: sr-only text excluded`);
  assert((prompt.match(/\d\. EDIT TEXT/g) ?? []).length === 4, `${label}: 4 text edits`);
  assert(prompt.includes('NOTE') && prompt.includes('Instruction: "Say \\"unlimited team members\\" instead?"'), `${label}: note`);
  assert((prompt.match(/\d\. MOVE/g) ?? []).length === 2 && prompt.includes('REMOVE'), `${label}: moves and remove`);
  assert(prompt.includes('```json'), `${label}: JSON block`);
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
    async () => {
      await page.locator('reword-overlay .copy').click();
      await page.waitForTimeout(200);
      return page.evaluate(() => navigator.clipboard.readText());
    });
  await page.screenshot({ path: out('fixture.png') });
  fs.writeFileSync(out('fixture-prompt.md'), prompt);
  checkPrompt(prompt, 'extension');

  // Commands from another extension context reach the page.
  const found = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(t.id, { type: 'reword:command', name: 'find_elements', params: { query: 'Book a demo button' } });
  });
  assert(found.ok && found.data[0]?.tag === 'button', 'reword:command find_elements via runtime message');

  // SPA navigation: items on another route are marked; coming back re-finds re-rendered nodes.
  await page.evaluate(() => history.pushState({}, '', '/pricing'));
  await page.waitForTimeout(800);
  assert((await page.locator('reword-overlay .item.elsewhere').count()) === 8, 'items marked as another page');
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    document.querySelector('h1').outerHTML = '<h1>Ship <span class="grad">faster</span> with Acme</h1>'; // framework re-render
  });
  await page.waitForTimeout(1000);
  assert((await text(page, 'h1')) === 'Ship it with Acme', 'edit re-applied after route change + re-render');
  assert((await page.locator('reword-overlay .item.missing').count()) === 0, 'nothing marked missing');

  // Re-injecting the content script replaces the instance: one overlay, changes applied once.
  await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['/content-scripts/content.js'] });
  });
  await page.waitForTimeout(600);
  assert((await page.locator('reword-overlay').count()) === 1, 're-injection keeps a single overlay');
  assert((await text(page, '#badge')) === 'New features', 'badge edit applied once after re-injection');
  assert((await page.locator('li').first().textContent()) === 'SOC 2 Type II', 'move applied once after re-injection');

  // Persistence: reload keeps the editor open and re-applies the queue.
  await page.reload();
  await page.waitForTimeout(1200);
  assert(await page.locator('reword-overlay .panel').isVisible(), 'editor reopened after reload');
  assert((await page.locator('reword-overlay .item').count()) === 8, 'queue intact after reload');
  assert((await text(page, 'h1')) === 'Ship it with Acme', 'edits re-applied after reload');
  await page.screenshot({ path: out('fixture-reload.png') });

  // A closed editor never touches the page: another tab on the same site stays as authored.
  const other = await ctx.newPage();
  await other.goto('http://localhost:4599/');
  await other.waitForTimeout(800);
  assert((await text(other, 'h1')) === 'Ship faster with Acme' && !(await other.locator('reword-overlay').count()), 'closed editor leaves the page alone');
  await ctx.close();

  // --- Bookmarklet flavour (no extension) ---
  const b = await chromium.launch({ headless: true });
  const bctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const bpage = await withFixture(bctx, { csp: STRICT_CSP });
  const code = fs.readFileSync(path.join(root, 'dist/reword.js'), 'utf8');
  const bm = fs.readFileSync(path.join(root, 'dist/bookmarklet.txt'), 'utf8').trim();
  assert(decodeURIComponent(bm.slice('javascript:'.length)) === code.trim(), 'bookmarklet decodes to reword.js');
  const bprompt = await scenario(bpage, () => bpage.evaluate(code), () => bpage.evaluate(() => window.Reword.getPrompt()));
  checkPrompt(bprompt, 'bookmarklet');
  const enforced = await bpage.evaluate(() => { try { document.createElement('div').innerHTML = '<b>x</b>'; return false; } catch { return true; } });
  assert(enforced, 'strict policy is enforced (innerHTML throws)');
  const violations = await bpage.evaluate(() => window.__violations.filter((v) => !v.includes('trusted-types') || !v.includes('<b>x</b>')));
  assert(violations.length === 0, `no CSP / Trusted Types violations under a strict policy ${JSON.stringify(violations)}`);
  await bpage.evaluate(code); // second click closes
  await bpage.waitForTimeout(100);
  assert(!(await bpage.locator('reword-overlay').count()), 'bookmarklet toggles closed');
  await bpage.evaluate(code); // and reopens with the queue
  await bpage.waitForTimeout(200);
  assert((await bpage.locator('reword-overlay .item').count()) === 8, 'bookmarklet reopens with the queue');
  await b.close();
}
