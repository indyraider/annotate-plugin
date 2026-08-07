---
name: annotate
description: Point-and-comment on the live local app. Invoked as /annotate [url]. Opens the Playwright browser to the local app, injects an inspect-element-style overlay so Matt can hover, click, and leave comments (each auto-screenshotted), then watches for those comments and fixes them. Dev tool only — never shipped, exempt from mobile-parity.
---

# /annotate — point-and-comment on the live app

Matt marks up the running app visually; the comments flow back here to be fixed.
This skill is the loop **you** run. `overlay.js` next to this file is a small loader;
the real implementation lives in `overlay/*.js` and is served locally by `serve.cjs`
rather than pasted into your context.

## Setup

1. **URL**: use the `[url]` arg, else `http://localhost:3000`. Assume the dev server
   is already up (Matt keeps `:3000` running — never kill it). If it's not, ask.
2. **Start the overlay server** (skip if one from earlier in this session is still up —
   reuse it, don't start a second one). `serve.cjs` never exits on its own (it just
   `listen()`s), so it **must be run in the background**, not as a normal foreground Bash
   call — a foreground call blocks forever on the very first step. If your harness has a
   background/async flag on its shell tool, use that. Otherwise, run `serve.cjs` from
   **this skill's directory** (same convention as step 4 — no path is hardcoded, no env var
   bet). Do not pass `--port`: it defaults to an ephemeral port, so nothing left running
   from an earlier session can ever collide with it.
   ```bash
   node <this skill's directory>/serve.cjs > /tmp/annotate-serve.log 2>&1 &
   sleep 1
   cat /tmp/annotate-serve.log   # -> {"url":"http://127.0.0.1:PORT/","port":PORT,"root":"..."}
   ```
   Read that JSON and keep the `url`. It binds to `127.0.0.1` only, never anything beyond
   your machine. **If the log isn't that single JSON line, the server did not start** — read
   the error (missing `node`, wrong working directory, etc.), fix it, and do not proceed with
   a guessed URL.
3. **Open the page**: `browser_navigate` to the URL (reuse the existing browser).
4. **Boot the overlay**: read `overlay.js` from this skill's directory — it's now a
   ~37-line loader, not the implementation — and `browser_evaluate` it, then call
   `__annotatorBoot` with the server URL from step 2:
   ```
   async () => { <contents of overlay.js>
     return await window.__annotatorBoot("<server url from step 2>");
   }
   ```
   The loader fetches the six implementation modules (`core.js`, `palette.js`, `ui.js`,
   `point.js`, `measure.js`, `index.js`) from that server and evals each in order — this
   is what replaces pasting the old 628-line single-file implementation into
   `browser_evaluate` on every run (~24k tokens each time). Idempotent: if the overlay
   is already running, `__annotatorBoot` resolves `"already-running"` and touches nothing.
5. **Tell Matt**, briefly: a pill is bottom-right, **starts OFF** (browse freely).
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
     if (!window.__annotator) {
       const bootUrl = localStorage.getItem("__ann_boot_url");
       if (!bootUrl) return { needReinject: true };
       <contents of overlay.js>
       await window.__annotatorBoot(bootUrl);
     }
     if (!window.__annotator) return { needReinject: true };
     const anns = await window.__annotatorWait(25000);
     return { anns, perf: window.__annotatorPerfTake ? window.__annotatorPerfTake() : [] };
   }
   ```
   A page reload wipes all page JS state, including `__annotatorBoot` itself — so the
   self-heal has to re-embed the loader (the same ~37 lines from Setup step 4, not the
   whole implementation) *before* it can call it. `__annotatorBoot` then re-fetches the
   six modules from the server you started in Setup step 2 (still running — it's a plain
   Node process, not tied to the page) and re-boots against the URL the overlay saved to
   `localStorage["__ann_boot_url"]` on first boot, restoring every annotation and its
   status from the same storage. Playwright awaits the promise; it returns the new
   annotations (the moment Matt saves one, or `[]` after ~25s).

   `{ needReinject: true }` and a **thrown/errored `browser_evaluate` call** are two
   different signals — don't conflate them:
   - **`{ needReinject: true }`** means only "no boot URL was ever saved" (fresh page,
     nothing booted yet this session) — recover by running Setup steps 2–4 from scratch.
   - **The `browser_evaluate` call itself erroring** (no return value at all) most often
     means the page **navigated or reloaded while the 25s poll was open** — routine during
     a long poll against an app Matt is actively editing (an HMR reload mid-evaluate kills
     it with a navigation error while the server is perfectly healthy). **Re-run the same
     poll first** — the reload self-heal (above) re-embeds the loader and picks up where it
     left off. Only if it **errors again immediately** should you suspect the `fetch` inside
     `__annotatorBoot` failed because the server from Setup step 2 is down or unreachable —
     `boot()` has no `catch` (deliberately — no retry/error-handling logic is built into it),
     so a dead server surfaces as a rejected promise / tool error, not as
     `{ needReinject: true }`. Only then restart the server and re-run Setup steps 2–4.
     Treating every errored evaluate as a dead server is the wrong call in the common case —
     it burns a server restart on a reload that would have self-healed on its own, and if the
     old server was still bound to a fixed port it would fail to restart at all.
2. **For each annotation in `anns`** `{ id, n, selector, descriptor, comment, url, hasImage }`:
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
3. **If the batch was empty** (timeout) 4–5 times in a row (~2 min quiet), pause and ask
   Matt if he's still going, rather than looping forever.

## Notes / ceilings

- The overlay is **session-ephemeral** (mirrored to `localStorage` only). Nothing is
  stored server-side. This is the intended "quick tool" tradeoff.
- **Toggling the mode off (pill or Alt+A) while a comment box is open discards the typed
  text.** `disable()` closes the box on the way out; this is intentional, not a bug — the
  box's own Escape handler only exists while the mode is enabled, so leaving the box open
  across a mode switch would make it un-closable. Save or Cancel before toggling off.
- Screenshots are **process-time**, not save-time — a purely transient state (hover-only
  tooltip, a dropdown that closed) may not re-show; the text comment carries those.
- While mode is **ON**, the overlay swallows `pointerdown`/`mousedown`/`click`/`auxclick`
  on page elements so a click can't navigate (links/buttons are inert until you flip OFF) —
  that's what lets you click a hyperlink to comment on it without being taken to its target.
  **Hold Shift** to bypass this for one interaction (peek/click-through).
- **Reload-proof**: on setup the overlay writes the server URL (not any source) to
  `localStorage["__ann_boot_url"]`; the watch-loop poll re-embeds the loader and calls
  `__annotatorBoot` with that URL after a reload. Editing a component the current page
  uses often triggers an HMR reload — the self-heal handles it, as long as the server
  from Setup step 2 is still running.
- **Hover inspector**: while ON, hovering shows a computed-style card (tag, size, font,
  weight, color, bg, padding, margin) so Matt has DevTools-level context while commenting.
- **Attached images** are downscaled to 1600px on the longest side and stored as JPEG
  under their OWN `localStorage` key (`__ann_img_<id>`), never inside the `__annotations`
  blob — one raw Retina paste can exceed the whole quota, and a throwing write there
  would silently stop persisting every annotation. An in-memory map backs it up when the
  quota refuses. Ceiling: an image only survives a page reload if it fit in localStorage;
  the text comment always survives, so a lost attachment degrades, never blocks.
- The overlay UI derives its own palette at runtime from the **host page's computed**
  background and text colors (`getComputedStyle` + `color-mix`, see `overlay/palette.js`),
  plus one fixed accent color — it does not read any app's design tokens or CSS variables.
  That's what lets it look native on any site it's dropped into, light or dark, standalone
  from whatever design system (if any) the host page uses.
- **Never add an `<input type="file">` to the overlay.** This browser is Playwright-driven:
  Chrome hands the file chooser to the automation client instead of opening the OS dialog,
  so Matt sees nothing, and every queued chooser makes your next tool call fail with
  `does not handle the modal state` until you cancel them one by one (`browser_file_upload`
  with no paths). Clipboard paste and drag-and-drop both avoid the chooser. `overlay.test.cjs`
  asserts this. Same trap fires if Matt clicks an upload control in the *app* while you're
  driving — if a call dies on modal state, cancel the choosers and carry on.
- Never edit the Tideswell app to support this tool; all behavior lives in `overlay.js`
  and the modules it loads from `overlay/`.
- **This plugin repo is the only edit surface.** `.claude/skills/annotate/` inside a
  consuming project is a copy, is gitignored there, and must never be edited — the
  copy drifted for two days once, silently missing an entire feature. To refresh a
  consumer, re-install the plugin.
