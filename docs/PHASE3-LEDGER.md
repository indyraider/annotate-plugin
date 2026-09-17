# Phase 3 — Compare

Spec §6.3 and §8 Phase 3. Built the **Compare** slice only; the Point and Measure upgrades in
§6.1/§6.2 (source mapping, multi-select, tree walk, save-time screenshots, silent context,
voice, LCP, server timing, mark point) are untouched and remain open.

Compare was taken first because the spec calls it "new, and the highest-value of the three",
because it is on the paid side of the line with Study, and because the toolbar was already
showing a greyed-out tab promising it.

## Shipped

- `core.normalisePath` / `entryKey` / `entryMetric` / `summariseRun` / `compareRuns` — all
  pure, all Node-tested. The spec flagged "Compare's delta maths" as the risky part.
- `measure.sessionTake()` — a non-draining copy of the whole recording session.
- Compare tab live; row 2 has Save baseline · Compare · regressions-only, plus a result list.
- `__annotatorCompareTake()` / `SaveBaseline()` / `ClearBaseline()`, all synchronous.
- Baseline persists to `localStorage`.

## Decisions worth keeping

**Two noise floors, and both must clear.** 5ms absolute AND 10% relative. 4ms off a 20ms action
is 20% and still noise; 400ms off a 30s upload is a big number and still noise. Requiring both
is what stops this reporting a win a second run would not reproduce.

**`thin` on any row where either side had one sample.** A percentage from n=1 is exactly the
shape of the finding that evaporated on a prod build. The row says so.

**`added` and `gone` are their own verdicts**, never a 100% regression or a 100% win.

**Paths are normalised before pairing.** Next appends a fresh `?_rsc=<hash>` to every navigation;
leaving it on means nothing ever matches, every row reads `added`, and the diff silently becomes
a list — a failure that would look like a working feature.

**`compareTake` returns the whole result, not just regressions.** A caller that only sees
regressions cannot tell "nothing got worse" from "nothing was measured in both runs".

**The baseline is in localStorage, not memory.** The whole point is that the agent works in
between, and editing a component the page uses triggers an HMR reload.

**take() drains, so Compare could not use it.** The watch loop calls it every ~25s; a Compare
built on it would compare the last few seconds against the baseline. Hence the session log,
fed by wrapping `buf.push` in ONE place so a future entry kind cannot forget to join in.

## Verification

- 7 sabotage proofs on the delta maths, all fired: query-stripping removed, each noise floor
  dropped, baseline-only treated as a win, thin-flagging removed, truncation swallowed, nav's
  cache-served fallback removed.
- 6 sabotage proofs on the wiring, all fired after one was found **decorative**: the
  `compareTake` pattern was a substring match and stayed green against
  `...sessionTake()).regressions`. Anchored on the semicolon; then it fired.
- Real-browser gate against a server whose latency is under test control: baseline at 30ms/action,
  then 300ms/action, then compare. Read `▲ +271ms (+839%) action /api/slow`, one regression, not
  thin, not truncated, and the no-baseline path reports itself rather than inventing a diff.
- Phase 2's gate updated (Compare is in the Alt+A rotation now) and re-run; hostile-page gate re-run.

## Two test bugs the gate surfaced, neither in the product

1. The gate reused the previous run's "done" marker, so `waitForFunction` returned instantly and
   the second run was read while its requests were still in flight — it looked exactly like
   Measure had recorded nothing.
2. The gate clicked the Compare tab while already in Compare, which **leaves** the mode
   (Phase 2's click-the-active-tab behaviour) and collapsed the panel it was about to read.

Both are worth recording: a browser gate that is wrong in this direction cries wolf, and the
first instinct was to go looking in `measure.js`.

## Ceilings, stated in SKILL.md

Two runs of one journey is a smoke test with numbers, not a benchmark. It catches 30ms becoming
300ms. It will not settle a 5% argument.

## Point and Measure (2026-09-17)

Plan: `docs/superpowers/plans/2026-09-17-annotate-phase3-point-measure.md`.

**Verified before building, not after.** React 19.2 has no `_debugSource`; every fiber has
`_debugOwner` and `_debugStack`. Next 16's `POST /__nextjs_original-stack-frames` resolves
server frames as sent and client frames once rewritten into the dist dir, percent-decoded.
A page-triggered `exposeBinding` screenshot took 28ms. Tideswell forbids the microphone.

**Shipped:** source file + component names on every comment; click-time screenshot;
Alt+↑/↓ tree walk; ⌘/Ctrl+click multi-select; page errors and failed requests from the last
30s; `lcp` entries; `ttfbMs` and `serverTiming` on navs; `mark` entries from the API, Alt+M and
the toolbar.

**Decisions worth keeping.**
- Multi-select is ⌘/Ctrl, not the spec's Shift: Shift is Point's peek.
- Source lookup is Next App Router dev only. Everything else gets component names and a grep.
- Context is page-wide. The spec said "the element's console errors"; no browser API can
  attribute an error to an element, so the label says what it is.
- Voice dropped: `Permissions-Policy: microphone=()` on the target app. macOS Dictation covers it.
- `setModeTools` no longer re-appends a showing node. Found while adding the Mark field:
  Measure repaints on every entry, and re-appending blurred the input mid-word. The Study
  favourite panel had the same latent bug.

**Out of plan, found by the gate.**
- **The nearest app file is often the wrong one to edit.** The login email field resolved to
  `src/components/ui/input.tsx:18`, the shared wrapper. Correct, and useless for "make this
  field wider", which means `login-form.tsx:64`, where this instance is placed. `source` now
  carries `usedFrom`, the next two app files up the tree, and SKILL.md tells the agent to pick
  before editing a shared component.
- **`<anonymous>` counted as an app file.** Seen when the client-frame sabotage left frames
  unrewritten: `usedFrom` listed `<anonymous>:1`. Filtered, with a unit test.
- **Cross-realm arrays in the context-hook test.** Arrays built inside the `vm` sandbox fail
  `deepStrictEqual` against identical outer arrays (foreign `Array` prototype). A test bug,
  not a product one; compared through `Array.from`.

**Verification.** `overlay.test.cjs` green. `gates/phase3.gate.cjs` green against Tideswell
`/login`: 9 checks, zero page errors. The client navigation hit the server both runs
(`rscMs 15-16`, `ttfbMs 13`), so the TTFB check was exercised, not skipped.

Sabotage checks, all fired on the assertion they target:
- core `parseDebugStack` reading line 1 -> the server-frame unit test.
- client frames sent unrewritten -> the gate's client-source check (server check stayed green,
  as it should: server frames need no rewrite).
- red square removed before the shot -> the gate's pixel check (`23,23,23`, not red). The
  first two attempts at this sabotage were themselves wrong: one opened the box before the
  shot and failed on `hasShot` instead, never reaching the pixel; one added a bare
  `textarea.__ann-ui` that the observer's `.__ann-ui textarea` selector never matched and
  passed. A sabotage has to be checked for landing on its target, same as a test.
- `throw err` removed from the fetch hook -> "the rejection was swallowed".
- `setModeTools` same-node guard removed -> the gate's focus check.

**MCP path.** The Playwright MCP browser was held by another session all session, again. The
SKILL.md boot snippet was extracted verbatim and run in a `vm` context holding only `page`,
the tool's own sandbox shape: boot returned `ready`, `__annotatorShoot()` returned a JPEG
after the snippet had returned, and again after a navigation. Still unexercised through
`browser_run_code_unsafe` itself.

**Update, same day, live testing.** The MCP browser came free: the boot ran through
`browser_run_code_unsafe` and `__annotatorShoot()` returned a JPEG. The MCP path is verified.

Matt found a bug in the first minutes: walk up with the ↑ button, move the mouse off it, and
the ring vanished. `onMousemove` checked "is this our chrome?" (hide the ring) before "is the
box open?" (leave the ring alone), and the ↑ button is chrome. Swapped the order. The gate check
written for it first **passed against the bug**: clicking ↑ redraws the ring, and the check
jumped the mouse straight off the button. It only went red once the mouse crossed the box on
the way out, as a hand does.

