# Annotate — session handoff, updated 2026-08-07 (evening)

Pick-up notes for a fresh session. Everything below is verified state, not recollection.

---

## Where the code is

**Two repos. The code lives in `annotate-plugin`; the specs and plans live in `brandscout-enterprise`.**

| | Path | Branch | State |
|---|---|---|---|
| Code | `/Users/mattjones/Documents/annotate-plugin` | `main` | **Phase 0 + 1a + 1b all merged and pushed.** |
| Docs | `/Users/mattjones/Documents/brandscout-enterprise` | `main` | spec + graph evidence + Phase 0/1a plans |
| Docs | same | `matt/annotate-phase1b` | the Phase 1b plan |

**`annotate-plugin` is now pushed** to `github.com/indyraider/annotate-plugin` — a public repo.
Matt made that call on 2026-08-07. Nothing sensitive is in the tree (scanned); the docs do
carry product strategy and a price band, which is a deliberate accepted cost, not an oversight.

⚠️ **Matt works in `brandscout-enterprise` on `matt/lookup-fields` with live uncommitted
changes.** Do not check out branches there or touch his working tree. Read with `git show`.

---

## What the product is

Read the spec first: `docs/superpowers/specs/2026-08-07-annotate-product-design.md` on
`brandscout-enterprise` `main`, backed by an evidence run at
`docs/graph/2026-08-07-annotate-as-product/report.md` (95 kept / 33 weakened / 7 killed claims).

**One-line thesis:** point-and-comment on your own app is commoditised and given away free by
many vendors; **design *acquisition* is the unoccupied seam.** Study any site you admire,
harvest it into your own portable design language, and your coding agent builds in that language.

Sold to **solo users**, single-player, price band **$10–25/month**. The free MIT plugin
(point + measure) stays free forever and is the funnel; **Study, the library and Compare are
the product.**

---

## What works today

**Phase 0 — Foundations.** Six modules served over local HTTP instead of pasted through agent
context (~24k tokens saved per run). Reload recovery is a stored URL.

**Phase 1a — Study mode.** A fourth mode: `off → on → measure → study → off`. `readElement`
(every property that separates expensive UI from ordinary UI, plus the CSS rules that actually
matched, including inside `@media`/`@supports`/`@layer`), `readPage` (palette by frequency,
type scale, spacing with a grid verdict, radii, shadows, the site's own tokens bucketed by
declaring selector), `readMotion` (four honestly-graded tiers). Works against any URL.

**Phase 1b — the library and the design language.**
- `core.reconcile` / `classifyValue` / `nearestInScale` — *fits* / *new* / **conflict**.
  Deliberately asymmetric: close-but-not-equal is a **conflict**, because 20px against a scale
  holding 16px means two radii doing one job. Wrong toward "conflict" costs one decision; wrong
  toward "new" corrupts the scale.
- `core.isAbsentValue` — the style read answers every property whether the author set one or
  not, so `shadow: none` and `padding: 0px` arrive looking like adoptable tokens. Filter before
  reconciling. Caller-side on purpose: "no shadow, deliberately" is sometimes a real decision.
- Favouriting — ★ a studied element with note and tags; `__annotatorStudyFavourite()` returns a
  Promise; **`url` is captured from `location.href` inside the module and cannot be overridden.**
- `templates/design-language.md` — a stack-neutral seed for a project with no design doc. An
  assertion proves it carries no Tideswell tokens *and* that it is still the document it claims
  to be (the token check alone passes on an empty file).
- `SKILL.md` — the favourite file format (markdown, deliberately) and the promote procedure.

**Verified end-to-end 2026-08-07** against `https://linear.app/` under `default-src 'self'`:
boot, pill cycled to Study through its own UI, pin, note and tags through the real inputs,
favourite resolved with real tier-1 motion and a populated `url`, file written with its
screenshot, template seeded, empty language → 4 adopt / 0 conflicts, a 4px-off second value →
1 conflict with all three options and real numbers, both promoted rows landed **inside** their
own sections. Zero page errors.

---

## Resume here

Phase 1b is complete and merged. **The next build is not yet planned** — Compare mode is spec
§8 Phase 3, the MCP server and licensing are Phase 4. Write a plan before touching either.

---

## Decisions waiting for Matt

1. **The classifier thresholds, now with real evidence.** 16px against a `[4, 12, 999]` scale
   reads **conflict** at 4px apart (ratio 0.33 of the nearest token; the cutoff is 0.5). That
   felt right at that scale. On a coarse scale where 4px is genuinely noise it will nag. Taste,
   not reasoning.
2. **A link cannot be favourited.** See below — needs a design decision, not an improvisation.
3. ~~Does `serve.cjs` retire?~~ **DECIDED 2026-08-07: retired.** `serve.cjs`, `serve.test.cjs`
   and the `overlay.js` loader are deleted. One boot path: `addInitScript` from disk. It costs
   a page reload and an RCE-equivalent tool call, both accepted knowingly.

---

## Open problems

**1. A link can't be favourited — pinning it also navigates away.** Study deliberately never
calls `preventDefault` (making the page inert was a Phase 1a bug; studying a site means moving
through it). So clicking a CTA pins it *and* follows the href, and the navigation wipes the
overlay before anything can be saved. The primary button is the most-studied element on the web
and it is the one thing this tool cannot capture. No modifier pins without navigating. Adding
one is a design decision.

**2. Licensing.** How to enforce a paid tier in a tool that runs entirely on the user's machine
when half of it is public MIT. Spec §10.5. Unanswered; blocks Phase 4, not anything sooner.

**3. The ES5 rule has no test.** `overlay/*.js` is supposed to be ES5 because it is `eval`'d
into arbitrary pages. Nothing asserts it. Left deliberately: every browser this runs in handles
modern syntax, so the rule has no live failure mode — but a guard would need to strip comments
first, because three modules contain the words "let", "class" and "const" in prose.

---

## CSP — CLOSED, and the recorded cause was wrong

Measured 2026-08-07. **CSP never blocked the overlay.** `browser_evaluate` runs over CDP, which
Chromium exempts from page CSP: all eight modules boot on `github.com` under `default-src 'none'`
with no `unsafe-eval`.

**What fails is the `fetch` to `127.0.0.1`, and CSP is not why.** It fails identically on a page
with *no CSP at all* and on a plain-`http` page. Chrome's own words: *"blocked by CORS policy:
Permission was denied for this request to access the `loopback` address space"* — Local Network
Access, which a public origin cannot obtain without a prompt no automated browser can answer.
`Page.setBypassCSP` and a `bypassCSP: true` context **both fail to help**, which is the tell.
From `http://localhost:3000` the same fetch returns 200 — that is why the dev app never saw it.

**The fix, verified booting:** skip the fetch. Read `overlay/*.js` from disk in the Playwright
process and evaluate each. See SKILL.md's Study limits section for the exact snippet.
**Still unexercised through `browser_run_code_unsafe` itself** — the verification ran in a
directly-driven Chromium, because the Playwright MCP browser was held by another session all day.
Re-run that one thing when the browser is free.

---

## How this codebase fails, and what the process is for

**23 defects across Phase 0 and 1a; four more in Phase 1b.** Almost none were crashes. The
recurring shape is **code that runs, looks right, and is quietly wrong**:

- The page sweep measured the inspector's own panel and reported *our* colours as the site's.
- The motion fingerprint matched its own filename on every page ever inspected.
- The classifier gave opposite verdicts for the same value depending on list order.
- Study's click handler blocked all navigation while the suite stayed green — the test checked
  which events it *listened to*, not what the handler *did*.
- **Phase 1b:** every value with a unit on it escaped collision detection and came back "new" —
  the unsafe direction — because `Number("20px")` is `NaN`. Found by cold-reading the procedure
  as the agent who would follow it, not by any test.

**And decorative tests keep appearing** — six in Phase 1a, two more in Phase 1b, where
sabotaging the subject left the suite green because another code path reached the same verdict.

**Therefore, non-negotiable in this codebase:**
1. **Every new assertion gets a break/restore proof.** Delete or invert the line it guards,
   confirm the suite *fails*, restore. A test that does not fail when its subject is gutted is
   not a test. In Phase 1b this caught two of six.
2. **Anything that reads the live browser gets a real-browser gate.** Measure mode once passed
   all 16 of its unit tests while reporting the exact opposite of the truth. Phase 1a's gate
   caught two bugs; Phase 1b's caught two more.
3. **Reviewers should be told to refuse instructions that are wrong.** They have, correctly:
   `canvas.getContext()` permanently binds an untouched canvas (a real mutation of the page
   being studied), and `mouseenter` can never fire on a `pointer-events:none` element.

---

## Invariants — do not weaken to make a test pass

- Mode guards stay `mode !== "on"`, never `=== "off"`. Four modes now.
- **Study intercepts only `click`** (Shift bypasses), and never calls `preventDefault`.
- **Study is read-only on the host page.** Enforced by an assertion proven to fail on an
  injected mutation.
- Tier 3's rAF patch and MutationObserver revert on every exit path; the sampler is idempotent.
- The page sweep caps at 8000 elements and reports `truncated` honestly.
- No `<input type="file">` anywhere — Chrome routes the chooser to the automation client and
  jams the agent's next tool call.
- `overlay/*.js` is **ES5** — it is `eval`'d into arbitrary pages.
- `core.js` stays **DOM-free** — it is `require`d in plain Node by the self-check. The guard is
  a source-text grep, so even the word `getComputedStyle` in a *comment* trips it. Reword the
  comment; never weaken the guard.

Self-checks (dependency-free, manual, never framework-wired):
```
node skills/annotate/overlay.test.cjs
```
(`serve.test.cjs` went with `serve.cjs` on 2026-08-07 — there is one self-check now.)
