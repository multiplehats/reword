# Reword

Click text on any live page, edit it in place, queue lots of small copy changes, then copy one prompt that a coding agent (Cursor, Claude Code, …) can apply to the source.

It isn't a CMS. Nothing is written back to the site, and the site doesn't need a preview or dev mode. The overlay is injected from the browser. Your edits exist only in your tab until you copy the prompt.

[![Reword demo: click a headline on a live page, edit it inline, leave a comment, then copy the agent prompt](docs/demo.gif)](docs/demo.mp4)

<sub>Click the GIF for the full-quality video.</sub>

## Install

```bash
pnpm install
pnpm build            # Chrome extension → .output/chrome-mv3, plus dist/ (bookmarklet, userscript, drop-in)
```

| Flavour | Where | How to open |
| --- | --- | --- |
| **Chrome extension** (preferred) | `.output/chrome-mv3` → `chrome://extensions` → *Load unpacked* | Toolbar button or **Alt+Shift+E**. Tick *Enable on this site* in the panel to also get the **E** key on that host. |
| **Bookmarklet** | open `dist/install.html` and drag the button to the bookmarks bar (or paste `dist/bookmarklet.txt` as a bookmark URL) | Click the bookmark. Click it again to close. |
| **Userscript** | install `dist/reword.user.js` in Tampermonkey or Violentmonkey | **Alt+Shift+E** or the userscript menu |
| **Drop-in `<script>`** | serve `dist/reword-dropin.js` from your own site | Opens automatically on `?copyedit=1`, then **Alt+Shift+E**. It stays inert unless the host is localhost, `*.local` or `*.test`, the URL has `?copyedit`, or the tag has `data-always`. `?copyedit=0` switches it off. |

`pnpm dev` runs WXT in watch mode and opens a browser with the extension loaded.

## Use

1. Open the panel. **Pick mode** is on, so clicks select text instead of following links.
2. **Edit copy**: click a headline, paragraph, button label, badge, list item and so on, then type.
   - **Enter** saves and **Esc** reverts. **Shift+Enter** inserts a line break.
   - **⌘/Ctrl+Enter** saves and turns pick mode back on.
3. If you clicked too deep, for example the `<span>` inside a button, a yellow **`span · ↑ parent button`** chip appears. Click it to widen the selection to the parent.
4. **Comment**: click text and write a note instead of rewriting it. **Enter** saves and **Esc** cancels.
5. **Browse**: every queued item appears with its number, before/after text, context and page. Click an item to scroll to the element and flash it. Use the trash icon to remove one. There's also JSON **Import/Export**.
6. **Copy prompt (N)** or **⌘/Ctrl+Shift+C** copies the agent brief. Chrome may keep ⌘⇧C for DevTools while DevTools is open, so use the button then.

Other controls:
- **Undo** reverts the last change on the page too.
- **Highlight all** outlines every queued element.
- **Clear** removes every change and reverts the page.
- **Esc** with nothing selected turns pick mode off, so the page behaves normally again.

The queue survives reloads and navigating between pages on the same site:
- **Extension:** saved in `chrome.storage.session`, per origin. It is cleared when the browser quits, so old edits never end up in a later prompt.
- **Other flavours:** saved in `sessionStorage`, per tab.

In a single-page app, queued items are found again after navigation or a re-render. The lookup tries the selector, then the fallback selector, then an element with the same text. If none match, the item is kept and marked *element not found*.

## The prompt

This is the same markdown brief as in the spec. Each change lists the page URL, the selector, a readable context such as `section#pricing › under “Simple pricing” › <li>`, and the From/To text or the comment. The brief ends with the rules for the agent and a fenced JSON copy of the change list. Numbers match the on-page badges.

Choices that make the strings easier to grep:

- **Source casing.** Text is read from the DOM text nodes, not `innerText`. An `uppercase` badge therefore reads `New feature`, not `NEW FEATURE`. Screen-reader-only text and hidden text are skipped.
- **Search terms.** When the copy is split across elements, as in `Ship <span>faster</span>`, the individual segments are listed as search terms.
- **Source hints.** Attributes such as `data-sentry-source-file`, `data-component` and `data-framer-name`, and similar ones from Lovable, v0 and locator tools, are included when they're present.

## Layout

```
src/core/        framework-free overlay shared by every flavour
  overlay.ts     panel, picking, inline editing, badges, re-finding
  dom.ts         pickability, selectors, context, snapshots
  text.ts        text extraction + normalisation
  prompt.ts      markdown + JSON prompt
entrypoints/     WXT extension (content script + background)
src/standalone/  bookmarklet / userscript / drop-in entries
scripts/         build-standalone.mjs (esbuild → dist/), make-icons.mjs
test/            vitest unit tests, fixture.html, e2e.mjs (Playwright)
```

The overlay renders inside a Shadow DOM using adopted stylesheets and `createElement`, with no `innerHTML`. This lets it work on pages with strict CSP or Trusted Types. The only changes it makes to host elements are temporary `contenteditable`/`spellcheck` attributes on the element being edited.

## Test

```bash
pnpm test        # unit tests (happy-dom)
pnpm test:e2e    # builds, then drives test/fixture.html through the real extension and the bookmarklet
```
