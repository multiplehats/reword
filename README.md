# Reword

Mark up any live page: edit copy in place, remove elements, move them around and leave notes. Then copy one prompt that a coding agent (Claude Code, Cursor, …) can apply to the source.

It isn't a CMS. Nothing is written back to the site, and the site doesn't need a preview or dev mode. The editor is injected from the browser, makes no network or AI calls, and your changes exist only in your browser until you copy the prompt.

[![Reword demo: click a headline on a live page, edit it inline, leave a comment, then copy the agent prompt](docs/demo.gif)](docs/demo.mp4)

<sub>Click the GIF for the full-quality video.</sub>

## Install

```bash
pnpm install
pnpm build            # Chrome extension → .output/chrome-mv3, plus dist/ (bookmarklet, userscript, drop-in)
```

| Flavour | Where | How to open |
| --- | --- | --- |
| **Chrome extension** (preferred) | `.output/chrome-mv3` → `chrome://extensions` → *Load unpacked* | Toolbar button or **Alt+Shift+E**. Tick *Open with E on this site* in the panel to also get the **E** key on that host. |
| **Bookmarklet** | open `dist/install.html` and drag the button to the bookmarks bar (or paste `dist/bookmarklet.txt` as a bookmark URL) | Click the bookmark. Click it again to close. |
| **Userscript** | install `dist/reword.user.js` in Tampermonkey or Violentmonkey | **Alt+Shift+E** or the userscript menu |
| **Drop-in `<script>`** | serve `dist/reword-dropin.js` from your own site | Opens automatically on `?copyedit=1`, then **Alt+Shift+E**. It stays inert unless the host is localhost, `*.local` or `*.test`, the URL has `?copyedit`, or the tag has `data-always`. `?copyedit=0` switches it off. |

`pnpm dev` runs WXT in watch mode and opens a browser with the extension loaded.

## Use

Open Reword. While it's open, clicks on the page select elements instead of following links or submitting forms.

- **Hover** outlines an element and shows its tag, a short selector and its size.
- **Click** selects it. An action bar appears next to it:
  - **↑ parent** (shows the parent's tag, e.g. `↑ button`): widens the selection when you clicked too deep, like the `<span>` inside a button.
  - **Edit text** (or double-click the element): edit the copy in place. **Enter** saves, **Esc** cancels, **Shift+Enter** adds a line break.
  - **Remove**: hides the element. It stays in the DOM, so you can restore it.
  - **Note**: attach an instruction such as "make this bigger". A numbered pin marks the element. **⌘/Ctrl+Enter** saves. Click the pin to edit the note.
  - **Drag handle (⠿)**: drag the element anywhere on the page. Near its own siblings it snaps to reorder them. Anywhere else it drops before or after the element under the pointer, moving it into that container, which is outlined while you drag. If the selection has no siblings (the text inside a nav link), the handle moves its nearest ancestor that does (the `<li>`). With the handle focused, the arrow keys reorder one sibling at a time.
- **Hold Alt to browse.** Clicks and hovers go to the page again, so you can open menus, follow links and scroll. Release Alt to go back to marking up. Alt+click on a link is turned into a normal click, so Chrome doesn't download it.
- **Esc** clears the selection.

### Changes panel

The panel sits at the bottom right. Drag it by its header, or collapse it.

- A numbered list of your changes: ~~old~~ → new for text edits, plus removes, notes and moves. Click an item to scroll to the element and flash it. **×** reverts that change.
- **Undo** and **Redo**, also **⌘/Ctrl+Z** and **⌘/Ctrl+Shift+Z** when you're not typing.
- **Clear all** reverts everything, with an inline **Undo** for 8 seconds.
- **Copy prompt (N)**, or **⌘/Ctrl+Shift+C**. Chrome may keep ⌘⇧C for DevTools while DevTools is open, so use the button then.

**Several pages.** Keep marking up as you move around the site (hold Alt and click a link). Changes from every page of the site go into one session and one prompt, grouped by page. Only the current page's changes are applied live; click a change from another page to go there. Client-side route changes in single-page apps are followed too.

**Persistence.** Your changes survive reloads and navigation within the site:
- **Extension:** saved in `chrome.storage.session`, per origin. It is cleared when the browser quits, so old edits never end up in a later prompt.
- **Other flavours:** saved in `sessionStorage`, per tab.

When the page loads or re-renders, changes are matched back to elements by selector (and, for text edits, by their text). A change whose element can't be found stays in the list, marked *Not on page*, and still goes into the prompt. Nothing on the page changes while Reword is closed.

## The prompt

~~~
I reviewed the live page and want these changes applied to the source code.
Page: https://acme.test/  |  Title: Acme  |  Viewport: 1280x860

1. EDIT TEXT
   Element: <h1> — selector: `#hero h1`
   Section: Hero
   Old: "Ship faster with Acme"
   New: "Ship it with Acme"
   Search terms (text is split across elements): "Ship", "faster", "with Acme"
   Context HTML: `<h1>Ship <span class="grad">faster</span> with Acme</h1>`

2. MOVE
   Move `#pricing li:nth-of-type(2)` ("SOC 2 Type II") to be before `#pricing li:nth-of-type(1)` ("Unlimited seats") within `ul`.
   Section: Pricing — "Simple pricing"
   Context HTML: `<li>SOC 2 Type II</li>`

Rules for the coding agent:
- Locate each element by searching the codebase for its old text first, …
…
```json
[ … the same changes as JSON … ]
```
~~~

Each change lists the element, a stable selector, the section it sits in (nearest landmark and heading), the original context HTML and what to do. The brief ends with rules for the agent and a JSON copy of the change list. Numbers match the panel.

Choices that help the agent find the right source:

- **Source casing.** Text is read from the DOM text nodes, not `innerText`, so an `uppercase` badge reads `New feature`, not `NEW FEATURE`. Screen-reader-only and hidden text is skipped.
- **Search terms.** When copy is split across elements, as in `Ship <span>faster</span>`, the separate pieces are listed.
- **Source hints.** Attributes such as `data-sentry-source-file`, `data-component` and `data-framer-name`, and similar ones from Lovable, v0 and locator tools, are included when present.
- **Stable selectors.** `id`, `data-testid` and other `data-*` attributes, `aria-label`, `href`/`alt`/`name` and meaningful class names are preferred. Generated names (`css-1x2y3z`, CSS Modules hashes, Tailwind utilities) are skipped.
- Several edits to one element become one entry (original → latest). Editing text back to the original drops the entry.

## Driving it from code

Every action, from the UI or anywhere else, goes through one command layer, so an agent can mark up a page the same way a person does:

```js
const { executeCommand, getToolDefinitions } = window.Reword; // bookmarklet, userscript, drop-in

const [cta] = (await executeCommand('find_elements', { query: 'Book a demo button' })).data;
await executeCommand('edit_text', { elementId: cta.elementId, newText: 'Get a demo' });
const { prompt } = (await executeCommand('get_prompt')).data;
```

Commands: `select_element`, `select_parent`, `edit_text`, `remove_element`, `add_note`, `move_element`, `revert_change`, `undo`, `redo`, `clear_all`, `list_changes`, `get_prompt`, `copy_prompt`, `find_elements`, `get_page_outline`, `set_enabled`. Each takes JSON parameters that are validated against its schema and returns `{ ok, data?, error? }`; none throw. `getToolDefinitions()` returns them as Anthropic tool definitions (`getToolDefinitions('openai')` for OpenAI), ready to hand to a model.

In the extension, other extension contexts can send `{ type: 'reword:command', name, params }` to a tab with `chrome.tabs.sendMessage`.

## Layout

```
src/core/          framework-free editor shared by every flavour
  reword.ts        createReword(): open/close/destroy, public API
  commands.ts      executeCommand(name, params); definitions.ts + validate.ts hold the schemas
  session.ts       change list, undo/redo, persistence, re-finding elements
  engine.ts        the only code that changes the page DOM (apply/unapply a change)
  describe.ts      selectors, sections, source hints, context HTML
  text.ts          source-casing text extraction
  query.ts         find_elements, get_page_outline
  prompt.ts        the prompt
  ui/              Shadow DOM root, overlay + action bar, panel, event interception
entrypoints/       WXT extension (content script + background)
src/standalone/    bookmarklet / userscript / drop-in entries
scripts/           build-standalone.mjs (esbuild → dist/), make-icons.mjs
test/              vitest unit tests, fixture.html, e2e.mjs (Playwright)
```

The UI renders inside a Shadow DOM, built with `createElement` and styled with a constructable stylesheet (no `innerHTML`), so it works on pages with strict CSP or Trusted Types.

## Test

```bash
pnpm test        # unit tests (happy-dom)
pnpm test:e2e    # builds, then drives test/fixture.html through the real extension and the bookmarklet
```

## Credits

The editing model, command layer, design and most of the UI come from [Agent Markup](https://github.com/risonsimon/agent-markup) by Rison Simon, used with permission under the MIT license. Reword adds the bookmarklet, userscript and drop-in flavours, source-casing text extraction, search terms and source hints in the prompt.

## License

[MIT](LICENSE)
