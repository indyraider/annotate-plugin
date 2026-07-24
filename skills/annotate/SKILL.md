---
name: annotate
description: Point-and-comment on your live local web app. Invoked as /annotate [url]. Opens the Playwright browser to your local app, injects an inspect-element overlay so you can hover, click, and leave comments on real elements; the comments flow back into the session to be fixed. Requires a Playwright MCP server. Local development tool only.
---

# /annotate — point-and-comment on your live app

The user marks up their running local app visually; the comments flow back here to be fixed.
This skill is the loop **you (Claude)** run. The overlay lives in `overlay.js` next to this file.

**Prerequisite — Playwright MCP.** This skill drives the browser through a Playwright MCP
server (`browser_navigate`, `browser_evaluate`, `browser_take_screenshot`, `browser_tabs`).
This plugin bundles one (`@playwright/mcp`). If those tools aren't available, tell the user to
connect the Playwright MCP server before continuing.

## Setup

1. **URL**: use the `[url]` arg, else `http://localhost:3000`. Assume the user's dev server is
   already running; if it isn't reachable, ask them to start it.
2. **Open the page**: `browser_navigate` to the URL (reuse the existing browser).
3. **Inject the overlay**: read `overlay.js` from this skill's directory and pass its full
   contents as the body of `browser_evaluate`'s `function`, i.e. `() => { <contents of overlay.js> }`.
   It's idempotent (guards on `window.__annotator`) and **auto-themes to the host app's colors**.
4. **If the app needs auth**: the Playwright browser has its own session. If it lands on a login
   page, ask the user to sign in in that browser window (or drive the login if they give you a way).
5. **Tell the user**, briefly: a pill is bottom-right, **starts OFF** (browse freely). Flip it
   **ON** (click the pill or **Alt+A**) to comment; hovering highlights the element, shows a
   **computed-style inspector card**, and the cursor becomes a **crosshair**; click opens a comment
   box (**⌘/Ctrl+Enter** or **Save**); **hold Shift** to click through to the app for one action;
   the **?** button toggles a shortcut guide. Flip OFF to keep browsing. Say **"done"** to stop.

## Watch loop

Repeat until the user says done (or the browser closes / evaluate errors):

1. **Long-poll (self-healing)** for comments — one `browser_evaluate`:
   ```
   async () => {
     if (!window.__annotator) { var s = localStorage.getItem("__ann_boot"); if (s) (0, eval)(s); }
     if (!window.__annotator) return { needReinject: true };
     return await window.__annotatorWait(25000);
   }
   ```
   On first setup the overlay caches a self-contained bootstrap in `localStorage`, so a page
   reload re-boots the overlay here for free. Playwright awaits the promise; it returns the new
   annotations (the moment the user saves one, or `[]` after ~25s). Only if `{ needReinject: true }`
   comes back (cache gone) do a full re-inject (Setup step 3).
2. **For each returned annotation** `{ id, n, selector, descriptor, comment, url }`:
   - **Screenshot it** (optional but useful): `browser_evaluate` → `() => window.__annotatorReveal("<id>")`
     (scrolls it into view; falls back to matching by tag+text if the DOM moved), then
     `browser_take_screenshot`. The `#n` pin is visible in the shot, so annotation `n` ↔ pin `n`.
   - **Find the source**: if `descriptor.source` is set (React dev `_debugSource`), go straight to
     that `file:line`. Otherwise grep the codebase for `descriptor.text`, `descriptor.className`, or a
     `data-*`/`aria-label` from `descriptor.attrs`, scoped by `url` (which route/page it's on).
     Confident → fix. Two candidates → show the user, let them pick.
   - **Fix or queue**: process in the order returned (save order). If mid-fix when a batch arrives,
     finish the current one first, then the rest — tell the user what you're on and what's queued.
3. **If the batch was empty** (timeout) 4–5 times in a row (~2 min quiet), pause and ask the user
   if they're still going, rather than looping forever.

## Notes / ceilings

- **Session-ephemeral**: annotations are mirrored to `localStorage` only. Nothing is stored
  server-side. Editing a component the current page uses often triggers an HMR reload — the
  self-healing poll re-boots the overlay from the cache.
- **Shift = peek/click-through**: while ON, the overlay swallows `pointerdown`/`mousedown`/`click`/
  `auxclick` so a click can't navigate. Hold Shift to bypass that for one interaction.
- **Adaptive UI**: the overlay reads the host page's background + text colors (via canvas, so
  `lab()`/`oklch()`/etc. all resolve) and derives its palette — so it blends into any app, light or
  dark. One fixed accent (`ACCENT` in `overlay.js`) is the tool's own identity; change it there.
- **Screenshots are process-time**, not save-time — a purely transient state (a hover-only tooltip,
  a dropdown that closed) may not re-show; the text comment carries those.
- The tool never edits the host app to function — all behavior lives in `overlay.js`.
