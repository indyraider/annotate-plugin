# Annotate — point & comment on your live app, or take any site's design system apart

A Claude Code plugin with two faces. **Point at any element in your running local web app and
leave a comment** — like the comment tool in design apps — and have Claude Code pick those
comments up and fix them. And **point Study mode at any site on the web** — yours, a
competitor's, a piece of design inspiration — and get back its real computed styles, the
design system behind the whole page, and what drives its motion.

You flip it on, hover to inspect, click an element, type what you want changed, and Claude
grabs the comment (with a screenshot and the element's details), finds the code, and edits it.
Great for a fast "walk the app and mark everything that's off" review pass.

> Tip: drop a screenshot at `docs/screenshot.png` and it'll show here.

## Study — point at any site, get its design system back

This is the headline feature. Flip the pill to **Study** (its 4th state) and it becomes a
reverse-engineering tool for whatever page it's dropped into — **any URL**, not just your
local app: `/annotate https://someothersite.com` is a completely normal invocation.

- **Per-element readout** — hover previews live, click pins it. Get back the real computed
  styles minus the tag's own browser defaults, the actual CSS rules that matched (with their
  `@media`/`@layer` context), and a best-effort Tailwind translation.
- **Whole-page design system** — one sweep gives you the site's palette, type scale, weights,
  fonts, spacing (with a grid verdict — "these are all multiples of 4"), radii, shadows, and
  its own custom-property design tokens, including a separate bucket for dark/themed
  overrides.
- **Motion, graded by confidence, not just capability** — four tiers, from "the browser's own
  animation API, complete" down to "a source map exists at this URL" (see `SKILL.md` for the
  full breakdown). Every finding says which tier it came from, because a browser-standard
  fact and a JS-driven-motion inference are not the same kind of claim.
- **Read-only, and doesn't lock you in** — Study never modifies the page it's inspecting, and
  unlike the comment/annotate mode below, it doesn't make the page inert: clicking a link
  navigates normally, because studying a site means moving through it.

Honest about what it can't do: it won't reconstruct an illustration's artwork (just its
dimensions/URL/placement), it can't fetch or parse a source map it finds (only reports that
one exists), and a site with a strict Content-Security-Policy (no `unsafe-eval`, or a
`connect-src` that blocks `127.0.0.1`) will refuse the overlay outright — an open problem,
not a solved one, and worth knowing since the sites most worth studying are often the ones
with the strictest CSP.

## What the comment/annotate side does

- **Inspect-element hover** — highlights the element under your cursor and shows a computed-style
  card (tag, size, font, weight, color, background, padding, margin). Cursor becomes a crosshair.
- **Click to comment** — a small box opens on the element; type the change, Save.
- **Comment pins** — each comment drops a numbered pin on its element.
- **Comments flow to Claude** — Claude long-polls the page, so it picks up each comment within a
  second or two, maps it to the source file, and fixes it (in the order you left them).
- **Hold Shift to click through** — operate the app normally (open a dropdown/modal) without
  leaving annotate mode, then keep commenting.
- **Reload-proof** — survives page reloads (including HMR) by re-embedding the tiny loader
  and re-fetching from the same server; a reload wipes the page's JS entirely, so nothing
  survives it un-reinjected.
- **Adaptive UI** — reads your app's own background/text colors and themes itself to match, light
  or dark. It is not a hardcoded box; it blends into whatever app you drop it into.

## Requirements

- **Claude Code** with plugin support.
- **A Playwright MCP server.** This plugin bundles [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp)
  and starts it automatically, so `npx` / Node must be available on your machine. If you already run
  your own Playwright MCP, remove the `mcpServers` block from `.claude-plugin/plugin.json`.

## Install

```
/plugin marketplace add indyraider/annotate-plugin
/plugin install annotate@annotate-tools
/reload-plugins
```

(Replace `indyraider/annotate-plugin` with wherever you host this repo.)

## Use

In a session where your local dev server is running:

```
/annotate:annotate
```

or just `/annotate` if the short form is available. Optionally pass a URL:
`/annotate http://localhost:5173` for your own app, or `/annotate https://someothersite.com`
to send Study mode at any site on the web.

Then:

| Action | What it does |
|--------|--------------|
| **Alt + A** (or click the pill) | Cycle the mode: off → on (annotate) → measure → study → off |
| **Hover** | Annotate/Study: highlight + inspect the element |
| **Click** | Annotate: leave a comment on it. Study: pin the readout on it (link clicks still navigate) |
| **⌘/Ctrl + Enter** | Save the comment (annotate mode) |
| **Shift** (hold) | Click through for one action, in either annotate or study mode |
| **Esc** | Cancel the open comment (annotate mode) |
| **?** | Show / hide the shortcut guide |

Say **"done"** when you're finished and Claude stops watching.

## How it works

The skill (`skills/annotate/SKILL.md`) starts a small local static server
(`skills/annotate/serve.cjs`) that serves the overlay's implementation modules
(`skills/annotate/overlay/*.js`), then tells Claude to open your app in the Playwright
browser, evaluate a ~37-line loader (`overlay.js`), and point it at that server. The
loader fetches the eight modules (`core.js`, `palette.js`, `ui.js`, `point.js`,
`measure.js`, `study-motion.js`, `study.js`, `index.js`) and boots the overlay. This exists
to cut per-run context cost: the old single-file overlay was 628 lines pasted directly into
`browser_evaluate` on every run (~24k tokens); serving it means only the tiny loader is ever
pasted, and a page reload re-embeds that tiny loader and re-fetches the modules from the same
server — a reload wipes all page JS, including the loader itself, so the self-heal has to
re-inject it before it can call back into the server. The server
binds to `127.0.0.1` only — it's a dev-loopback convenience, never reachable off your
machine, and never proxies to anything outside the plugin's own files. (This fetch-and-eval
boot path is itself subject to the target page's Content-Security-Policy — see Study's CSP
note above — because it needs both `connect-src` to allow `127.0.0.1` and `script-src` to
allow `'unsafe-eval'`.)

The overlay captures your comments into the page; Claude reads them back via a
promise-based long-poll (`window.__annotatorWait`), so it feels live. Each comment carries a robust
element descriptor (text, classes, `data-*`, a CSS path, and React dev source info when present) that
Claude greps to the right file. Nothing is stored server-side — comments live for the session only.

## Limitations

- **Local dev tool for the comment/annotate/measure side.** Those three modes are for
  reviewing your own app while you build it, not an end-user feature. **Study is the
  exception** — read-only and built to run against any URL, local or not.
- **Source mapping is best-effort** unless your framework exposes dev source info — Claude will
  occasionally show you a couple of candidate files and let you pick.
- **Screenshots are process-time**, so a purely transient state (a tooltip that only shows on hover)
  may not be recreated; the text comment carries those.
- **Study has its own honest limits** — no illustration reconstruction, no fetching/parsing
  found source maps, first-paint-only effects are missed, Shadow DOM isn't walked, the page
  sweep caps at 8000 elements, and a strict Content-Security-Policy (no `unsafe-eval`, or
  `connect-src` blocking `127.0.0.1`) refuses the overlay outright — an open problem, not a
  solved one. See `SKILL.md`'s Study section for the full breakdown, including the four
  motion-detection tiers and their confidence levels.

## License

MIT — see [LICENSE](LICENSE).
