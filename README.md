# Annotate — point & comment on your live app

A Claude Code plugin that lets you **point at any element in your running local web app and
leave a comment** — like the comment tool in design apps — and have Claude Code pick those
comments up and fix them.

You flip it on, hover to inspect, click an element, type what you want changed, and Claude
grabs the comment (with a screenshot and the element's details), finds the code, and edits it.
Great for a fast "walk the app and mark everything that's off" review pass.

> Tip: drop a screenshot at `docs/screenshot.png` and it'll show here.

## What it does

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

or just `/annotate` if the short form is available. Optionally pass a URL: `/annotate http://localhost:5173`.

Then:

| Action | What it does |
|--------|--------------|
| **Alt + A** (or click the pill) | Toggle annotate mode on / off |
| **Hover** | Highlight + inspect the element |
| **Click** | Leave a comment on it |
| **⌘/Ctrl + Enter** | Save the comment |
| **Shift** (hold) | Click through to the app for one action |
| **Esc** | Cancel the open comment |
| **?** | Show / hide the shortcut guide |

Say **"done"** when you're finished and Claude stops watching.

## How it works

The skill (`skills/annotate/SKILL.md`) starts a small local static server
(`skills/annotate/serve.cjs`) that serves the overlay's implementation modules
(`skills/annotate/overlay/*.js`), then tells Claude to open your app in the Playwright
browser, evaluate a ~37-line loader (`overlay.js`), and point it at that server. The
loader fetches the six modules and boots the overlay. This exists to cut per-run context
cost: the old single-file overlay was 628 lines pasted directly into `browser_evaluate`
on every run (~24k tokens); serving it means only the tiny loader is ever pasted, and a
page reload re-embeds that tiny loader and re-fetches the modules from the same server —
a reload wipes all page JS, including the loader itself, so the self-heal has to re-inject
it before it can call back into the server. The server
binds to `127.0.0.1` only — it's a dev-loopback convenience, never reachable off your
machine, and never proxies to anything outside the plugin's own files.

The overlay captures your comments into the page; Claude reads them back via a
promise-based long-poll (`window.__annotatorWait`), so it feels live. Each comment carries a robust
element descriptor (text, classes, `data-*`, a CSS path, and React dev source info when present) that
Claude greps to the right file. Nothing is stored server-side — comments live for the session only.

## Limitations

- **Local dev tool.** It's for reviewing your own app while you build it, not an end-user feature.
- **Source mapping is best-effort** unless your framework exposes dev source info — Claude will
  occasionally show you a couple of candidate files and let you pick.
- **Screenshots are process-time**, so a purely transient state (a tooltip that only shows on hover)
  may not be recreated; the text comment carries those.

## License

MIT — see [LICENSE](LICENSE).
