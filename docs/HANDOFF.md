# Annotate — session handoff, 2026-08-07

Pick-up notes for a fresh session. Everything below is verified state, not recollection.

---

## Where the code is

**Two repos. The code lives in `annotate-plugin`; the specs and plans live in `brandscout-enterprise`.**

| | Path | Branch | State |
|---|---|---|---|
| Code | `/Users/mattjones/Documents/annotate-plugin` | `main` | Phase 0 + Phase 1a merged. **23 commits unpushed.** |
| Code | same | `matt/phase1b-library` | Phase 1b tasks 1–2 done, 4 commits ahead of main |
| Docs | `/Users/mattjones/Documents/brandscout-enterprise` | `main` | spec + graph evidence + Phase 0/1a plans |
| Docs | same | `matt/annotate-phase1b` | **the Phase 1b plan lives only here** |

**Nothing has been pushed to GitHub.** `annotate-plugin` is a public repo (`github.com/indyraider/annotate-plugin`) — pushing publishes the code and its commit messages. That is Matt's call and has not been made.

⚠️ **Matt was working in `brandscout-enterprise` on `matt/lookup-fields` with staged changes.** Do not check out branches there or touch his working tree. The Phase 1b plan was committed through a temporary git worktree for exactly this reason. If a worktree still exists under the session scratchpad, `git worktree prune` after removing it.

---

## What the product is

Read the spec first: `docs/superpowers/specs/2026-08-07-annotate-product-design.md` on `brandscout-enterprise` `main`. It is backed by an evidence run at `docs/graph/2026-08-07-annotate-as-product/report.md` (95 kept / 33 weakened / 7 killed claims).

**One-line thesis:** point-and-comment on your own app is commoditised and given away free by many vendors; **design *acquisition* is the unoccupied seam.** Study any site you admire, harvest it into your own portable design language, and your coding agent builds in that language.

Sold to **solo users**, single-player, price band **$10–25/month**. The free MIT plugin (point + measure) stays free forever and is the funnel; **Study, the library and Compare are the product.**

---

## What works today

**Phase 0 — Foundations (merged).** Six modules served over local HTTP instead of pasted through agent context (~24k tokens saved per run). Reload recovery is a stored URL, replacing a hand-maintained list of `.toString()`'d function sources that died silently if you forgot one.

**Phase 1a — Study mode (merged).** A fourth mode: `off → on → measure → study → off`.
- `readElement` — every property that separates expensive UI from ordinary UI, plus the CSS rules that actually matched, **including inside `@media` / `@supports` / `@layer`**.
- `readPage` — palette by frequency, type scale, spacing scale **with a grid verdict**, radii, shadows, and the site's own custom-property tokens bucketed by declaring selector (themed sets stay separate).
- `readMotion` — four honestly-graded tiers: CSS complete via `getAnimations()`; GSAP timelines and ScrollTriggers; Lottie's JSON URL; and for bundled libraries, an inferred "JS writes transform ~60×/sec" rather than a fabricated answer.
- Agent entry points: `__annotatorStudyTake()` (**Promise**, ~1s, 3s ceiling), `__annotatorStudyPage()` (sync).
- **Works against any URL** — `/annotate https://somesite.com` is valid and is the whole point.

**Phase 1b tasks 1–2 (branch only).**
- `core.reconcile` / `classifyValue` / `nearestInScale` — decides *fits* / *new* / **conflict**. Deliberately asymmetric: a value close to an existing token is a **conflict**, because 20px against a scale holding 16px means two radii doing one job. Being wrong toward "conflict" costs one decision; being wrong toward "new" corrupts the scale.
- Favouriting — ★ a studied element with note and tags; `__annotatorStudyFavourite()` returns a Promise; **`url` is captured from `location.href` inside the module and cannot be overridden.**

---

## Resume here — Phase 1b, task 3 of 5

Plan: `docs/superpowers/plans/2026-08-07-annotate-phase1b-library.md` on `brandscout-enterprise` branch `matt/annotate-phase1b`.
Read it with: `git show matt/annotate-phase1b:docs/superpowers/plans/2026-08-07-annotate-phase1b-library.md`

Ledger of everything done so far: `docs/PHASE1B-LEDGER.md` in this repo.

Remaining:
- **Task 3** — the favourite's markdown file format, and a **stack-neutral** seed template for projects with no design doc. An assertion must prove the template contains no Tideswell tokens; portability is a product constraint.
- **Task 4** — the promote procedure in `SKILL.md`: read the user's existing design language, run `reconcile`, present *fits* silently / *new* with a suggested home / **conflict** with all three options (adopt, adapt, exception) in plain language. **The agent must never choose for the user.** Never append to the bottom of their document.
- **Task 5** — end-to-end in a real browser, against a **real public site, not localhost**.
- **Final whole-branch review.**

Execute with `superpowers:subagent-driven-development`.

---

## The decision waiting for Matt

**The classifier's thresholds are judgment calls, not measured ones** — how close counts as a conflict (currently >50% of the nearest token's value), and how many tokens make a scale a scale (currently 2). They are the difference between a reconcile step that catches real collisions and one that nags about every value. **Task 5 is the first time they fire against a real design system.** The plan expects them to be tuned then. That is a taste decision, not a reasoning one — ask him.

---

## Two open problems, neither solved

**1. CSP — the big one.** The overlay reaches a page via in-page `eval` plus a `fetch` to `127.0.0.1`. A site whose `script-src` lacks `'unsafe-eval'`, or whose `connect-src` blocks localhost, **will refuse it entirely.** The sites most worth studying are the likeliest to ship a strict CSP. Documented honestly in `SKILL.md` as open. A code comment once claimed this was solved; it was wrong and was corrected. **Do not let it drift back to "handled."** Note Playwright can bypass CSP via `bypassCSP` — worth investigating whether Playwright MCP exposes it.

**2. Licensing.** How to enforce a paid tier in a tool that runs entirely on the user's machine when half of it is public MIT. Spec §10.5. Unanswered; blocks Phase 4, not 1b.

---

## How this codebase fails, and what the process is for

**23 defects were caught across Phase 0 and 1a.** Almost none were crashes. The recurring shape is **code that runs, looks right, and is quietly wrong**:

- The page sweep measured the inspector's own panel and reported *our* colours as the site's design system — on every invocation.
- The motion fingerprint matched its own filename, claiming "motion library detected" on every page ever inspected. After that fix, it still matched `promotions.js` — near-universal on ecommerce sites.
- The classifier gave opposite verdicts for the same value depending on list order.
- Study's click handler blocked all navigation while the suite stayed green — the test checked which events it *listened to*, not what the handler *did*.

**And six decorative tests** — assertions satisfied by comment text, or `/--/` matching a section banner. Each guarded a real fix. Each would have passed forever with its subject deleted.

**Therefore, non-negotiable in this codebase:**
1. **Every new assertion gets a break/restore proof.** Delete the line it guards, confirm the suite *fails*, restore. A test that does not fail when its subject is gutted is not a test.
2. **Anything that reads the live browser gets a real-browser gate.** Measure mode once passed all 16 of its unit tests while reporting the exact opposite of the truth. Phase 1a's gate caught two bugs no unit test found.
3. **Reviewers should be told to refuse instructions that are wrong.** They did, twice, correctly: `canvas.getContext()` permanently binds an untouched canvas (a real mutation of the page being studied), and `mouseenter` can never fire on a `pointer-events:none` element.

---

## Invariants — do not weaken to make a test pass

- Mode guards stay `mode !== "on"`, never `=== "off"`. Four modes now; inverting them makes point mode swallow clicks during Study.
- **Study intercepts only `click`** (Shift bypasses). Point mode makes the page inert; Study must not — studying a site means navigating it.
- **Study is read-only on the host page.** Enforced by an assertion proven to fail on an injected mutation.
- Tier 3's rAF patch and MutationObserver revert on every exit path; the sampler is idempotent.
- The page sweep caps at 8000 elements and reports `truncated` honestly. Silent truncation cost this project 7920 automation runs once.
- No `<input type="file">` anywhere — Chrome routes the chooser to the automation client and jams the agent's next tool call.
- `overlay/*.js` is **ES5** — it is `eval`'d into arbitrary pages.
- `core.js` stays **DOM-free** — it is `require`d in plain Node by the self-check.

Self-checks (dependency-free, manual, never framework-wired):
```
node skills/annotate/overlay.test.cjs
node skills/annotate/serve.test.cjs
```
