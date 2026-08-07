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
