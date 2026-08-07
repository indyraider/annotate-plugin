# Phase 2 — the Layout B toolbar

Spec: §3 (Layout B, approved) and §8 Phase 2, in `brandscout-enterprise` at
`docs/superpowers/specs/2026-08-07-annotate-product-design.md`. Built without a separate plan
document — the layout was already approved in the spec and no fork appeared that needed one.

## Shipped

- Bottom-CENTRED two-row toolbar replacing the bottom-right pill. Row 1 (Point · Measure ·
  Compare · Study │ Queue ?) never changes; row 2 swaps with the mode and collapses on `off`.
- Direct mode selection; clicking the active mode leaves it. Alt+A still rotates.
- Compare ships **disabled** with a title naming it as Phase 3, so the top row never has to
  grow a button and move the others.
- Queue button + on-demand panel with the running count; clicking a row reveals that annotation.
- `core.nextMode(current, enabledKeys)` — the rotation, pure and Node-tested.
- `ui.js` still owns no mode state: `setModes(items, onSelect)` takes the list from index.js.

## The defect this phase found

**A host page can swallow the toolbar's clicks.** On linear.app the first click on a mode
button reached `document` in the capture phase with the correct target and then never arrived
at the button — the page runs its own capture-phase click handler that calls
`stopPropagation()`. Per-button listeners live downstream of that and simply lose. Intermittent
(depends on the host's hydration state), which is worse than deterministic: it looked like a
flaky test.

Fixed by wiring every control through ONE delegated listener on `document` in the CAPTURE
phase. `stopPropagation` from any listener at or below that node cannot silence a listener
already registered on the same node. Only `stopImmediatePropagation` registered on
document-capture *before* us beats it, and nothing can defend against that.

Proven against four hostile pages (plain, document-capture stopPropagation, the same plus
preventDefault, body-capture stopPropagation). The bubble-phase version fails all three
hostile ones — verified by sabotage, not assumed.

## Verification

- `overlay.test.cjs` / `serve.test.cjs` green. 5 sabotage proofs on the new assertions, all
  fired by name (capture→bubble, dropped isOurs guard, dropped disabled check, row 2 no longer
  collapsing, a second document listener).
- Real-browser gate on linear.app: 10 checks, zero page errors — mode order, boots off with
  row 2 collapsed, direct selection, row 2 swapping, click-active-to-leave, Compare inert,
  Alt+A skipping Compare, queue on demand, bottom-centred and on-screen at 1440.
- Phase 1b's end-to-end re-run against the new toolbar: favourite still resolves with real
  tier-1 + tier-3 motion, note, tags and url; promote still lands in the right sections.

**Harness gap, unchanged from Phase 1b:** all browser work ran in a directly-driven Chromium
because the Playwright MCP browser was held by another session. The `browser_run_code_unsafe`
disk-injection boot is still unexercised through the tool itself.

## Not done

- Row 2 currently holds one line of text for Point and Measure. The spec expects fifteen tools
  eventually; the mechanism is there (`setModeTools(node)`), the tools are not.
- Queue rows are text only — no status filter, no bulk actions.
