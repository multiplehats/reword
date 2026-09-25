// Builds the non-extension flavours into dist/:
//   reword.js            – plain IIFE (window.Reword), what the bookmarklet runs
//   bookmarklet.txt      – javascript: URL with the whole IIFE inlined
//   reword.user.js       – Tampermonkey / Violentmonkey userscript
//   reword-dropin.js     – first-party <script> for localhost / ?copyedit=1
//   install.html         – page with a draggable bookmarklet link
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const out = 'dist';
await mkdir(out, { recursive: true });

const bundle = async (entry) => {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  return res.outputFiles[0].text.trim();
};

const bookmarkletJs = await bundle('src/standalone/bookmarklet.ts');
const userJs = await bundle('src/standalone/userscript.ts');
const dropinJs = await bundle('src/standalone/dropin.ts');

const bookmarklet = `javascript:${encodeURIComponent(bookmarkletJs)}`;

const userscript = `// ==UserScript==
// @name         Reword — inline copy editor
// @namespace    https://github.com/reword
// @version      ${pkg.version}
// @description  Click any text on a live page, edit it in place, and copy one prompt your coding agent can apply. Toggle with Alt+Shift+E.
// @match        http://*/*
// @match        https://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

${userJs}
`;

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const install = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reword bookmarklet</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0e11; color: #e8e8ec; font: 15px/1.6 system-ui, sans-serif; }
  main { max-width: 520px; padding: 32px 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #a1a1aa; }
  a.bm { display: inline-block; margin: 16px 0; padding: 10px 16px; border-radius: 10px; background: #3b82f6; color: #fff; font-weight: 600; text-decoration: none; cursor: grab; }
  code { background: #1f2026; padding: 1px 6px; border-radius: 5px; }
</style>
</head>
<body>
<main>
  <h1>Reword bookmarklet</h1>
  <p>Drag this button to your bookmarks bar. Click it on any page to open the copy editor; click again to close it.</p>
  <a class="bm" href="${escapeAttr(bookmarklet)}">✎ Reword</a>
  <p>Changes are kept in <code>sessionStorage</code> for that site and tab, so you can reload or move between pages and click the bookmarklet again to continue.</p>
</main>
</body>
</html>
`;

await Promise.all([
  writeFile(`${out}/reword.js`, `${bookmarkletJs}\n`),
  writeFile(`${out}/bookmarklet.txt`, `${bookmarklet}\n`),
  writeFile(`${out}/reword.user.js`, userscript),
  writeFile(`${out}/reword-dropin.js`, `${dropinJs}\n`),
  writeFile(`${out}/install.html`, install),
]);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} kB`;
console.log(`dist/reword.js        ${kb(bookmarkletJs)}`);
console.log(`dist/bookmarklet.txt  ${kb(bookmarklet)}`);
console.log(`dist/reword.user.js   ${kb(userscript)}`);
console.log(`dist/reword-dropin.js ${kb(dropinJs)}`);
console.log('dist/install.html');
