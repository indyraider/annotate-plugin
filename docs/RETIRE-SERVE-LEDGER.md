# serve.cjs retired — 2026-08-07

Matt's decision, taken with the trade-off on the table.

## Gone

`skills/annotate/serve.cjs`, `skills/annotate/serve.test.cjs`, `skills/annotate/overlay.js`.

## What replaces it

```js
for (const f of FILES) await page.context().addInitScript({ path: dir + "/" + f });
await page.reload({ waitUntil: "domcontentloaded" });
await page.evaluate(() => { window.__annotatorMods.index.setup(); return "ready"; });
```

`addInitScript` takes a **path**, so Playwright reads the files in its own process and injects
them over CDP before the document's own scripts — the same mechanism as `evaluate`, which
Chromium does not subject to page CSP. No server, no fetch, nothing pasted through the agent's
context, and nothing left for Local Network Access to refuse.

Verified inside a faithful reproduction of `browser_run_code_unsafe`'s actual sandbox
(`vm.createContext({ page, __end__ })`) on github.com under `default-src 'none'`, stripe.com,
linear.app and localhost.

## Costs, accepted knowingly

1. **A page reload at boot.** Anything typed or opened on that page is lost, so boot before the
   user starts. In exchange, `addInitScript` persists on the browser *context*, so every later
   navigation re-injects the modules by itself and the watch-loop self-heal is now just
   `index.setup()` — strictly simpler than the old re-embed-the-loader-and-re-fetch dance.
2. **`browser_run_code_unsafe` is RCE-equivalent**, so the harness may prompt each boot.
3. **If that tool is unavailable, there is no cheap fallback.** SKILL.md documents the
   expensive one — read the eight files and `browser_evaluate` each — and says to state that
   you are using it and why. That is precisely the ~24k tokens/run the server existed to avoid.

## What the deletion cost the test suite, and how it was replaced

The loader's `FILES` array and `core.js`'s `OWN_MODULE_FILES` were two hand-maintained lists
cross-checked against each other. Deleting the loader removed one side of that check.

The survivor is now checked against two things that cannot drift by omission:
- `fs.readdirSync("overlay/")` — set equality, so a ninth module added to the directory and
  forgotten everywhere else fails the suite instead of silently reintroducing the
  `isOwnModuleUrl` self-match bug (Study reporting its own module as a detected motion library).
- SKILL.md's boot snippet — same files, same order. Prose drifts, and an agent following a
  stale list boots a partial overlay that fails on the first missing dependency, which reads
  as "the tool is broken" rather than "the doc is stale".

The `__annBootBase` self-match guard is **kept** even though nothing writes a boot base any
more. The null path was always the dangerous one — a null base excludes nothing — and it is
still live for anyone loading the modules as plain `<script src>` tags, which the local preview
harness does.

## Verification

`overlay.test.cjs` green (it is the only self-check now). All four browser gates re-run after
the deletion: vm-sandbox boot, hostile-page toolbar, Compare end to end, Phase 2 toolbar, plus
Phase 1b's Study end-to-end against linear.app. Zero page errors.
