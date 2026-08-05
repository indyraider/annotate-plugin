---
name: annotate
description: Point-and-comment on the live local app. Invoked as /annotate [url]. Opens the Playwright browser to the local app, injects an inspect-element-style overlay so Matt can hover, click, and leave comments (each auto-screenshotted), then watches for those comments and fixes them. Dev tool only — never shipped, exempt from mobile-parity.
---

# /annotate — point-and-comment on the live app

Matt marks up the running app visually; the comments flow back here to be fixed.
This skill is the loop **you** run. The overlay lives in `overlay.js` next to this file.

## Setup

1. **URL**: use the `[url]` arg, else `http://localhost:3000`. Assume the dev server
   is already up (Matt keeps `:3000` running — never kill it). If it's not, ask.
2. **Open the page**: `browser_navigate` to the URL (reuse the existing browser).
3. **Inject the overlay**: read `overlay.js` from this skill's directory and pass its
   full contents as the body of `browser_evaluate`'s `function`, i.e.
   `() => { <contents of overlay.js> }`. It's idempotent (guards on `window.__annotator`).
4. **Tell Matt**, briefly: a pill is bottom-right, **starts OFF** (browse freely).
   Flip it **ON** (click the pill or press **Alt+A**) to comment; press again for
   **measure** mode (records timings, clicks pass straight through — see below); again to
   return to off. In annotate mode, hover highlights the
   element **and shows an inspector card** (computed font/size/color/padding/etc.), click
   opens a comment box, **⌘/Ctrl+Enter** or **Save** submits. In the box he can **⌘V a
   screenshot** (⌃⌘⇧4 copies one straight to the clipboard) or **drag an image file onto
   the box** from Finder — a thumbnail confirms it, ✕ removes it.
   **Hold Shift to "peek"** — click through to the app for one action (open a
   dropdown/modal) without leaving annotate mode. Flip OFF to keep browsing. The pill
   shows the running count. Say **"done"** to stop.

## Measure mode

The pill cycles **off → annotate → measure → off** (click, or Alt+A). In measure mode the
overlay records and **does not touch clicks** — Matt uses the app completely normally while
it watches. The pill shows the running entry count.

Entries come back on the same poll, in `perf`. Five kinds, each with `t` (ms since page load):

| kind | fields | what it tells you |
|------|--------|-------------------|
| `nav` | `from`, `to`, `servedFromCache`, `rscMs`, `toPaintMs` | Client-side route change. `servedFromCache: true` means the click needed **no** server request. Detected from the browser's own resource timings by looking **backward** for a `?_rsc=` request — Next starts that request *before* it pushes the URL, and does not route it through `window.fetch`. |
| `action` | `url`, `ms`, `ok` | A Server Action (e.g. sending a message), spotted by its `Next-Action` header. `ms` is time to response headers — the server's thinking time. |
| `img` | `url`, `ms`, `ttfbMs`, `transferSize`, `decodedBodySize`, `status` | A chat attachment. **`ms` is the trustworthy field** — it covers the whole two-hop redirect. `ttfbMs`, `transferSize`, `decodedBodySize` and `status` read `0` whenever the request redirects cross-origin to storage, because that origin sends no `Timing-Allow-Origin` header. Do not read `transferSize: 0` as a cache hit here. |
| `shift` | `value` | The page jumping (e.g. an image landing with no space reserved). |
| `longtask` | `ms` | The main thread blocked — the browser, not the server. |

A `{ t, kind: "dropped", n }` entry means the 500-entry buffer overflowed and dropped `n`
oldest entries. Truncation is never silent.

**The combination case:** in measure mode Matt notices something slow, flips one notch to
annotate and points at it. The comment and the timing entries for that same moment arrive in
the same batch — no reconciling two tools.

**Ceilings.** Cross-origin resource timings are opaque: anything that redirects to storage
reports real `ms` but zeroed `ttfbMs`/`transferSize`/`status`, so per-image cache-hit and
status-code detection is not available (verified live 2026-08-04). Browser-side only: this
shows that a navigation spent 400ms waiting on the
server, not which database call inside it was slow. Recording stops on reload (`mode` is not
persisted and the buffer is in-memory — deliberately, since image attachments already compete
for the `localStorage` quota); the loop drains continuously so at most ~25s is lost, and Matt
flips it back on. `layout-shift` and `longtask` are Chromium-only, which the Playwright
browser is. The first page load is not captured — recording starts when the mode is switched on.

## Watch loop

Repeat until Matt says done (or the browser closes / evaluate errors):

1. **Long-poll (self-healing)** for comments — one `browser_evaluate`:
   ```
   async () => {
     if (!window.__annotator) { var s = localStorage.getItem("__ann_boot"); if (s) (0, eval)(s); }
     if (!window.__annotator) return { needReinject: true };
     const anns = await window.__annotatorWait(25000);
     return { anns, perf: window.__annotatorPerfTake ? window.__annotatorPerfTake() : [] };
   }
   ```
   On first setup the overlay caches a self-contained bootstrap in `localStorage`, so a page
   reload re-boots the overlay here for free — no re-pasting `overlay.js`. Playwright awaits
   the promise; it returns the new annotations (the moment Matt saves one, or `[]` after ~25s).
   Only if `{ needReinject: true }` comes back (cache somehow gone) do a full re-inject (Setup step 3).
3. **For each annotation in `anns`** `{ id, n, selector, descriptor, comment, url, hasImage }`:
   - **If `hasImage`, pull Matt's attachment FIRST** — it's the most direct statement of
     what he means. **Never return the image through the poll or a plain evaluate**: a
     screenshot is ~100k+ tokens of base64 and would swamp the context. Route it
     browser → disk → `Read`, using `browser_evaluate`'s `filename` param so the result
     never enters the transcript:
     ```
     browser_evaluate({
       function: '() => window.__annotatorImageTake("<id>")',
       filename: 'ann-<id>.b64.txt'      // only the PATH comes back, never the data
     })
     ```
     `filename` must sit **inside the repo** (or `.playwright-mcp/`) — the scratchpad under
     `/private/tmp` is outside Playwright's allowed roots and the write is refused. A bare
     name lands in the repo root; delete it when done.
     Then decode and view it (the file holds a JSON-quoted `data:image/jpeg;base64,…`):
     ```
     python3 -c "import json,base64,sys,pathlib
     raw=pathlib.Path(sys.argv[1]).read_text().strip()
     s=json.loads(raw) if raw.startswith('\"') else raw
     pathlib.Path(sys.argv[2]).write_bytes(base64.b64decode(s.split(',',1)[1]))" IN.b64.txt OUT.jpg
     ```
     and `Read` the `.jpg`. `__annotatorImageTake` is **read-and-forget**, but the most
     recent image stays retrievable until the next take — so if the write fails (bad path,
     tool error) just call it again with the same id. Fetch it before you start fixing.
   - **Screenshot it**: `browser_evaluate` → `() => window.__annotatorReveal("<id>")`
     (scrolls it into view), then `browser_take_screenshot`. The `#n` badge is visible
     in the shot, so annotation `n` ↔ badge `n`. View it for visual context.
   - **Find the source**: if `descriptor.source` is set (React dev `_debugSource`), go
     straight to that `file:line`. Otherwise grep for `descriptor.text`,
     `descriptor.className`, or a `data-*`/`aria-label` from `descriptor.attrs`, scoped
     by `url` (which route/page it's on). Confident → fix. Two candidates → show Matt, he picks.
   - **Fix or queue**: process in the order returned (Save order). If you're mid-fix when
     a batch arrives, finish the current one first, then the rest — tell Matt what you're
     on and what's queued.
4. **If the batch was empty** (timeout) 4–5 times in a row (~2 min quiet), pause and ask
   Matt if he's still going, rather than looping forever.

## Notes / ceilings

- The overlay is **session-ephemeral** (mirrored to `localStorage` only). Nothing is
  stored server-side. This is the intended "quick tool" tradeoff.
- Screenshots are **process-time**, not save-time — a purely transient state (hover-only
  tooltip, a dropdown that closed) may not re-show; the text comment carries those.
- While mode is **ON**, the overlay swallows `pointerdown`/`mousedown`/`click`/`auxclick`
  on page elements so a click can't navigate (links/buttons are inert until you flip OFF) —
  that's what lets you click a hyperlink to comment on it without being taken to its target.
  **Hold Shift** to bypass this for one interaction (peek/click-through).
- **Reload-proof**: on setup the overlay writes a self-contained bootstrap to
  `localStorage["__ann_boot"]`; the watch-loop poll re-`eval`s it after a reload. Editing a
  component the current page uses often triggers an HMR reload — the self-heal handles it.
- **Hover inspector**: while ON, hovering shows a computed-style card (tag, size, font,
  weight, color, bg, padding, margin) so Matt has DevTools-level context while commenting.
- **Attached images** are downscaled to 1600px on the longest side and stored as JPEG
  under their OWN `localStorage` key (`__ann_img_<id>`), never inside the `__annotations`
  blob — one raw Retina paste can exceed the whole quota, and a throwing write there
  would silently stop persisting every annotation. An in-memory map backs it up when the
  quota refuses. Ceiling: an image only survives a page reload if it fit in localStorage;
  the text comment always survives, so a lost attachment degrades, never blocks.
- The overlay UI is styled with the app's own design tokens (`var(--surface-*)`,
  `var(--text-*)`, `var(--coral)`, glass-edge) so it matches DESIGN-LANGUAGE.md and is theme-aware.
- **Never add an `<input type="file">` to the overlay.** This browser is Playwright-driven:
  Chrome hands the file chooser to the automation client instead of opening the OS dialog,
  so Matt sees nothing, and every queued chooser makes your next tool call fail with
  `does not handle the modal state` until you cancel them one by one (`browser_file_upload`
  with no paths). Clipboard paste and drag-and-drop both avoid the chooser. `overlay.test.cjs`
  asserts this. Same trap fires if Matt clicks an upload control in the *app* while you're
  driving — if a call dies on modal state, cancel the choosers and carry on.
- Never edit the Tideswell app to support this tool; all behavior lives in `overlay.js`.
