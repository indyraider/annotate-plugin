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

## A second defect, found by looking

The toolbar rendered BLACK text on a DARK panel on stripe.com. Cause was in Phase 0's
palette, not Phase 2: stripe paints its background on a wrapper div, so `html` and `body`
both compute to `transparent`, the palette fell back to a hard-coded dark surface, and the
text colour still came from the page. Unreadable chrome on every light site built that way —
which is ordinary practice, not an edge case.

Fixed by inferring the background from the TEXT colour when the page gives us none (dark text
means a light page); a real background still wins. 3 sabotage proofs fired. Verified visually
on stripe (now light), linear (still dark), example.com (unchanged).

**Worth noting how it was found:** every unit test passed, both browser gates passed, and the
bug was plainly visible the moment a screenshot was opened. Add a look-at-it step to any
future phase that touches the chrome.

## The boot path, actually verified (decision 3, partially)

Matt chose "retire serve.cjs, one method". Before deleting the only working boot path I read
how `browser_run_code_unsafe` actually executes its snippet — and the method SKILL.md
documented **would not have worked.**

That tool runs the code in `vm.createContext({ page, __end__ })`: a bare sandbox whose only
host object is `page`. No `require`, no `fs`, no dynamic `import`. Tested inside a faithful
reproduction of that sandbox, four approaches fail:

| approach | result |
|---|---|
| `await import("node:fs/promises")` — what SKILL.md said | "a dynamic import callback was not specified" |
| `require("fs")` | "require is not defined" |
| `page.addScriptTag({ path })` | CSP: "Executing inline script violates…" |
| same + CDP `Page.setBypassCSP` | same — the bypass does not apply to an already-loaded document |

**What works:** `page.context().addInitScript({ path })` for each module, then `page.reload()`.
`addInitScript` takes a path, so Playwright reads the files in its own process, and injects
them over CDP before the document's own scripts — the same mechanism as `evaluate`, which
Chromium does not subject to page CSP. Verified `ready:true` on github.com (`default-src
'none'`), stripe.com, linear.app and localhost.

**Two costs Matt did not have when he decided**, so serve.cjs is NOT deleted yet:
1. It requires a **page reload** — anything typed or opened on the page is lost.
2. `browser_run_code_unsafe` is RCE-equivalent and may prompt for permission every boot.

serve.cjs still boots the local app with neither cost. That is a genuine trade-off rather than
the clean one-way-street the decision was made on, so it goes back to him.
