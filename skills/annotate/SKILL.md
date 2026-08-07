---
name: annotate
description: Point-and-comment on the live local app, plus a read-only Study mode that reverse-engineers any site's design system. Invoked as /annotate [url]. Opens the Playwright browser, injects an inspect-element-style overlay so Matt can hover, click, and leave comments (each auto-screenshotted), then watches for those comments and fixes them. Study mode (the 4th toolbar tab) works against any URL, not just the local app, and never modifies the page it inspects. Studied elements can be favourited to a design-studies/ library and promoted, through a reconcile step, into the user's own design language. Dev tool only — never shipped, exempt from mobile-parity.
---

# /annotate — point-and-comment on the live app

Matt marks up the running app visually; the comments flow back here to be fixed.
This skill is the loop **you** run. `overlay.js` next to this file is a small loader;
the real implementation lives in `overlay/*.js` and is served locally by `serve.cjs`
rather than pasted into your context.

## Setup

1. **URL**: use the `[url]` arg, else `http://localhost:3000`. Assume the dev server
   is already up (Matt keeps `:3000` running — never kill it). If it's not, ask. **If the
   `[url]` arg is a remote address** (e.g. `/annotate https://someothersite.com`), there is
   no local dev server to wait for — that's a normal invocation, most often heading for
   Study mode (see below), which is built to work against any site, not just the local app.
2. **Start the overlay server** (skip if one from earlier in this session is still up —
   reuse it, don't start a second one). `serve.cjs` never exits on its own (it just
   `listen()`s), so it **must be run in the background**, not as a normal foreground Bash
   call — a foreground call blocks forever on the very first step. If your harness has a
   background/async flag on its shell tool, use that. Otherwise, run `serve.cjs` from
   **this skill's directory** (same convention as step 4 — no path is hardcoded, no env var
   bet). Do not pass `--port`: it defaults to an ephemeral port, so nothing left running
   from an earlier session can ever collide with it.
   ```bash
   node <this skill's directory>/serve.cjs > /tmp/annotate-serve.log 2>&1 &
   sleep 1
   cat /tmp/annotate-serve.log   # -> {"url":"http://127.0.0.1:PORT/","port":PORT,"root":"..."}
   ```
   Read that JSON and keep the `url`. It binds to `127.0.0.1` only, never anything beyond
   your machine. **If the log isn't that single JSON line, the server did not start** — read
   the error (missing `node`, wrong working directory, etc.), fix it, and do not proceed with
   a guessed URL.
3. **Open the page**: `browser_navigate` to the URL (reuse the existing browser).
4. **Boot the overlay**: read `overlay.js` from this skill's directory — it's now a
   ~37-line loader, not the implementation — and `browser_evaluate` it, then call
   `__annotatorBoot` with the server URL from step 2:
   ```
   async () => { <contents of overlay.js>
     return await window.__annotatorBoot("<server url from step 2>");
   }
   ```
   The loader fetches the eight implementation modules (`core.js`, `palette.js`, `ui.js`,
   `point.js`, `measure.js`, `study-motion.js`, `study.js`, `index.js`) from that server
   and evals each in order — this
   is what replaces pasting the old 628-line single-file implementation into
   `browser_evaluate` on every run (~24k tokens each time). Idempotent: if the overlay
   is already running, `__annotatorBoot` resolves `"already-running"` and touches nothing.
5. **Tell Matt**, briefly: a toolbar sits **bottom-centre**, and it **starts with no mode
   selected** (browse freely). Top row never changes — **Point · Measure · Compare · Study**,
   then **Queue**; the second row shows whatever the selected mode needs and collapses when
   nothing is selected. **Click the mode you want** (no cycling), or press **Alt+A** to
   rotate `off → Point → Measure → Study → off`. **Clicking the mode you are already in
   leaves it**, which is how you get back to using the page.
   - **Point** — hover highlights the element **and shows an inspector card** (computed
     font/size/color/padding/etc.), click opens a comment box, **⌘/Ctrl+Enter** or **Save**
     submits. In the box he can **⌘V a screenshot** (⌃⌘⇧4 copies one straight to the
     clipboard) or **drag an image file onto the box** from Finder — a thumbnail confirms
     it, ✕ removes it. **Hold Shift to "peek"** — click through for one action (open a
     dropdown/modal) without leaving the mode.
   - **Measure** — records timings, clicks pass straight through (see below).
   - **Compare** — **greyed out**; it is spec Phase 3 and not built. It ships visible on
     purpose so the top row never has to grow a button and move the others.
   - **Study** — reverse-engineers styles/design-system/motion, read-only, works on any
     site. Row 2 holds the note/tags/★ Save favourite inputs.

   **Queue** opens a panel of saved comments on demand and carries the running count;
   clicking a row scrolls that annotation into view. Say **"done"** to stop.

   **The toolbar's controls are wired through one delegated listener on `document`, in the
   capture phase.** A host page that runs its own capture handler and calls
   `stopPropagation` — linear.app does, on the first click after boot — kills any
   per-button listener stone dead, and the toolbar is the only way into this tool. If you
   ever split that wiring back out per button, the tool silently stops responding on
   exactly the sites it is most worth using. `overlay.test.cjs` asserts there is exactly one.

## Measure mode

Select **Measure** in the toolbar (or Alt+A round to it). In measure mode the
overlay records and **does not touch clicks** — Matt uses the app completely normally while
it watches. Row 2 of the toolbar shows the running entry count.

Entries come back on the same poll, in `perf`. Five kinds, each with `t` (ms since page load):

| kind | fields | what it tells you |
|------|--------|-------------------|
| `nav` | `from`, `to`, `servedFromCache`, `rscMs`, `toPaintMs` | Client-side route change. `servedFromCache: true` means the click needed **no** server request. Detected from the browser's own resource timings by looking **backward** for a `?_rsc=` request — Next starts that request *before* it pushes the URL, and does not route it through `window.fetch`. |
| `action` | `url`, `ms`, `ok` | A Server Action (e.g. sending a message), spotted by its `Next-Action` header. `ms` is time to response headers — the server's thinking time. |
| `img` | `url`, `ms`, `ttfbMs`, `transferSize`, `decodedBodySize`, `status` | A chat attachment. **`ms` is the trustworthy field** — it covers the whole two-hop redirect. `ttfbMs`, `transferSize`, `decodedBodySize` and `status` read `0` whenever the request redirects cross-origin to storage, because that origin sends no `Timing-Allow-Origin` header. Do not read `transferSize: 0` as a cache hit here. |
| `shift` | `value` | The page jumping (e.g. an image landing with no space reserved). |
| `longtask` | `ms` | The main thread blocked — the browser, not the server. |

A `{ t, kind: "dropped", n }` entry means the 500-entry buffer overflowed and dropped `n`
oldest entries. Truncation is never silent.

**The combination case:** in measure mode Matt notices something slow, flips one notch to
annotate and points at it. The comment and the timing entries for that same moment arrive in
the same batch — no reconciling two tools.

**Ceilings.** Cross-origin resource timings are opaque: anything that redirects to storage
reports real `ms` but zeroed `ttfbMs`/`transferSize`/`status`, so per-image cache-hit and
status-code detection is not available (verified live 2026-08-04). Browser-side only: this
shows that a navigation spent 400ms waiting on the
server, not which database call inside it was slow. Recording stops on reload (`mode` is not
persisted and the buffer is in-memory — deliberately, since image attachments already compete
for the `localStorage` quota); the loop drains continuously so at most ~25s is lost, and Matt
flips it back on. `layout-shift` and `longtask` are Chromium-only, which the Playwright
browser is. The first page load is not captured — recording starts when the mode is switched on.

## Study mode

The toolbar's 4th tab. **This is the headline capability of the whole tool — Study works
against any URL, not just the local app you're building.** `/annotate https://someothersite.com`
is a completely valid invocation: point Study at a competitor's site, a piece of design
inspiration, anything on the public web, and take its design system apart.

Unlike annotate mode, Study **does not make the page inert** — only `click` is intercepted
(to pin the readout instead of following the link), and **holding Shift bypasses even that**.
Everything else (scrolling, hover states, `:hover`/`:focus` CSS) behaves normally, and
clicking a link navigates the page, because studying a site means moving through it, not
being trapped on one screen. Study **never writes to the page it inspects** — every read
goes through `getComputedStyle`/`getBoundingClientRect`/`getAnimations`, and its own UI
(the readout panel) is chrome appended fresh to `<body>`, same as the highlight box and
comment pins in the other modes.

**Driving it:**
1. Click **Study** in the toolbar (Setup step 5), or ask Matt to.
2. Hover previews the readout live; **click an element to pin it** (**Alt+click** if it is a
   link or button, so the page doesn't navigate away) — the panel then stays
   put while the mouse moves elsewhere, so you can pull the readout after moving on. Either
   Matt clicks the target himself, or you drive it with `browser_click`.
3. Pull the pinned element's full readout with a `browser_evaluate` that **awaits the
   Promise**:
   ```
   async () => await window.__annotatorStudyTake()
   ```
   Pull the whole-page design system (no pin needed) with a second, plain call:
   ```
   () => window.__annotatorStudyPage()
   ```

**`window.__annotatorStudyTake()` returns a Promise — this is easy to miss and a call that
doesn't `await` it gets back a Promise object, not data, and will misreport "no motion" or
crash on a `.then` that was never chained.** It resolves once the ~1s motion sample
completes (a 3s ceiling means it can never hang the tool call — if the sample hasn't
settled by then, it hands back whatever it has), and in practice resolves in about a
second. It resolves `null` if nothing is pinned yet.

What it resolves with:
```
{
  element: { tag, selector, box, styles, nonDefault, matchedRules, tailwind },
  motion:  { tier1, tier2, tier3, tier4, confidence }
}
```
`element.nonDefault` is `styles` minus the tag's own browser defaults (so `position: static`
on every div doesn't bury the one that says `sticky`); `element.matchedRules` is the actual
CSS rules that matched, each with its `@media`/`@supports`/`@layer` context if nested;
`element.tailwind` is a best-effort Tailwind-class translation of the computed styles.

`window.__annotatorStudyPage()` is **synchronous** (no `await` needed) — the whole-page
design-system sweep:
```
{ palette, typeScale, weights, fonts, spacing, radii, shadows, customProps, elementsScanned, truncated }
```
`palette`, `typeScale`, `weights`, `fonts`, `radii`, and `shadows` are frequency-ranked
(`[{ value, count }]`, most-used first) — a page's real palette is the handful of colors
used hundreds of times, not the one-off banner color. `spacing` carries a grid verdict
(`{ base, values, onGrid }` — e.g. `onGrid: true, base: 4` means "these are all multiples of
4"). `customProps` is the site's own design tokens (its CSS custom properties), bucketed
**by the selector they were declared under** — a plain `:root` set and a themed override
(`:root[data-theme="dark"]`, `.dark`) land in separate buckets, never merged, so you can
report the light and dark token sets as what they actually are.

**The four motion tiers — report the tier, never flatten the confidence.** `motion`
carries `tier1` through `tier4` plus a `confidence` summary
(`{ tiersWithData: [...], summary: "..." }`) that already names which tiers actually fired —
lean on it rather than re-deriving confidence yourself. **Never present a tier-3 inference
as a tier-1 fact** — "this element animates via `transform`, easing `cubic-bezier(...)`" is
only true if it came from tier 1; a tier-3 finding is "something JS-driven is writing to
this element's (or one of its descendants') style ~30 times a second," not a transition
curve, and must be worded that way.

| Tier | What it covers | Confidence |
|------|-----------------|------------|
| **1 — `getAnimations()`** | Every CSS transition, CSS animation, and Web Animations API animation, with real keyframes and timing. A browser standard since 2020. | **Complete, not approximate.** If tier 1 found it, report it as fact. |
| **2 — library reachable via a global** | GSAP (the jackpot): every tween and every ScrollTrigger binding — trigger, start, end, progress. Lottie: the animation's JSON URL (the whole animation *is* that file). Three.js: version + canvas count. | **Near-complete**, but only for libraries that expose a global. |
| **3 — detection without detail** | Bundled libraries with no global (Framer Motion never had one) fingerprinted from network entries, plus proof of JS-driven motion from a ~1s sample of the frame loop correlated against style mutations on **the element or its descendants** (`tier3.proof.scope`). | **Detection, not detail.** You learn *that* something animates (this element or below it) and roughly how, never the actual code or curve. |
| **4 — source maps** | Whether a source map exists for a fingerprinted script, and its URL. | **The jackpot when present** — but Study reports only that the map exists and where; **it does not fetch or parse it.** Never imply the original source is in hand — only that it's reachable. |

**`tier3.proof.status` can be `"cancelled"`, not just `"done"`.** A second `take()` call
pinned while the first is still sampling supersedes it — the superseded one resolves with
`status: "cancelled"` and `jsDriven: false`. **That `false` is not a finding** — it means
"this sample was superseded before it could observe anything," and `confidence.summary`
reflects that honestly as `"tier3: sample cancelled (superseded)"` rather than folding it
into "no motion detected." Don't report a cancelled sample as proof of no motion; re-`take()`
if you need a real answer for that element.

**Honest limits — report these, don't paper over them:**
- **Illustrations/images** yield dimensions, URL, and placement — never the artwork itself.
  That's an asset, not a style; no inspector reconstructs it.
- **Booting on a public site: it is not CSP, it is Local Network Access** (measured
  2026-08-07 — this bullet previously blamed CSP and was wrong). Two separate things were
  conflated:
  - **CSP does not block the overlay.** `browser_evaluate` runs over CDP, which Chromium
    exempts from page CSP. All eight modules eval and boot cleanly on `github.com`, whose
    policy is `default-src 'none'` with no `'unsafe-eval'` — `__annotator` comes up live and
    `__annotatorStudyPage()` returns the real sweep, with no console errors.
  - **The `fetch` to `127.0.0.1` is what fails, and CSP is not why.** It fails identically on
    a page with *no CSP at all* and on a plain-`http` page. Chrome says: *"blocked by CORS
    policy: Permission was denied for this request to access the `loopback` address space"* —
    Chrome's Local Network Access permission, which a public origin cannot get without a user
    prompt no automated browser can answer. `Page.setBypassCSP` and a context created with
    `bypassCSP: true` **both fail to help**, precisely because the block is not CSP.
    From a local origin (`http://localhost:3000`) the same fetch returns 200 — which is why
    this never showed up against the dev app.

  **The escape hatch, verified working:** skip the fetch. Read `overlay/*.js` from disk in the
  Playwright process and evaluate each in order — no network request, so there is nothing left
  to block. Costs no context tokens either, same as the server.
  ```
  browser_run_code_unsafe({ code: `async (page) => {
    const fs = await import("node:fs/promises");
    const dir = "<this skill's directory>/overlay";
    for (const f of ["core.js","palette.js","ui.js","point.js","measure.js","study-motion.js","study.js","index.js"])
      await page.evaluate(await fs.readFile(dir + "/" + f, "utf8"));
    return await page.evaluate(() => { window.__annotatorMods.index.setup(); return "ready"; });
  }` })
  ```
  Use this whenever the target is a public site; Setup's `__annotatorBoot` path is fine for
  the local app. **Not yet exercised through the MCP tool itself** — the boot was verified in
  a directly-driven Chromium, so if `browser_run_code_unsafe` is unavailable or refused, say
  so rather than falling back silently to a path that cannot work.
- **To study a button or link, hold Alt and click it** (fixed 2026-08-07). A plain click in
  Study mode pins the element *and* lets the page navigate, because studying a site means
  moving through it — making the page inert was a Phase 1a bug and must not come back.
  But that meant the primary CTA, the most-studied element on any site, was the one thing
  the tool could not capture: the navigation tore the overlay off the page before anything
  could be saved. **Alt+click pins and holds the page still.** It both prevents the default
  and stops propagation, because plenty of sites navigate from their own JS click handler
  rather than an `href`, and preventing the default says nothing to those. This is the only
  place Study is allowed to stop an event, and `overlay.test.cjs` asserts that the plain path
  still stops nothing.
- **First-paint-only effects are missed** — the overlay injects after the page has already
  loaded, so anything that only ever runs once, on initial paint, isn't there to observe.
- **Shadow DOM isn't walked.** Elements inside a shadow root need separate handling that
  doesn't exist yet — Study's readout and page sweep both only see light-DOM elements.
- **The page sweep caps at 8000 elements.** `truncated: true` means it hit the cap — pass
  that fact on to Matt rather than presenting a partial design system as if it were the
  whole one.
- **GSAP's per-tween accessors (`.targets()`, `.vars`) are probed with `typeof`, never
  assumed.** An older GSAP version without them yields a tween count with less per-tween
  detail — report that honestly as "less detail available," not as "no animation found."

## Favourites — the study library

Study answers "what is this?". A **favourite** is Matt saying "I want this." It saves the
pinned element's readout, his note and tags, and the URL it came from, into a
`design-studies/` directory **in his own project** — files he owns, not a tool-owned store.

**Driving it:** with an element pinned in Study mode, Matt types a note and tags in the
Study panel and hits Save; or you pull it yourself:
```
async () => await window.__annotatorStudyFavourite()
```
**It returns a Promise — `await` it** (same reason as `__annotatorStudyTake()`: the motion
tiers fill in asynchronously). It resolves `null` if nothing is pinned. Otherwise:
```
{ element, motion, note, tags, url, ts }
```
`url` is captured from `location.href` inside the overlay and **cannot be passed in or
overridden**. Six months on, a decision whose source nobody can find is not a decision.

**The two-document rule.** Favourites are **staging**, not the design language. Forty
admired cards from forty sites, appended together, is a mood board with three radius scales
and no ease — the opposite of a system. Favourites may contradict each other freely; they
only become a design language by going through the promote step, one decision at a time.
**Never write a favourite into Matt's design document directly.**

### The file on disk

One markdown file per study, screenshot beside it, in `design-studies/`:

```markdown
# Pricing card — layered shadow

**From:** https://example.com/pricing
**Saved:** 2026-08-07
**Tags:** card, elevated, dark

![](./pricing-card-layered-shadow.png)

## Element
| property | value |
|---|---|
| radius | 20px |
| shadow | 0 8px 30px rgb(0 0 0 / .12) |
| padding | 24px 28px |

## Tailwind
`rounded-2xl border border-white/10 px-7 py-6 ...`

## Motion
**tier 1** — transition: transform 180ms cubic-bezier(.2,.8,.2,1)
**tier 2** — gsap: y 60→0, opacity 0→1, 0.8s power3.out

## Notes
<Matt's note, verbatim>
```

- **Title** is the short name Matt gave it; if he gave none, generate one from the tag and
  the element (`Pricing card — layered shadow`). The filename is that title slugified, and
  the screenshot uses the **same slug** so the pair stays obvious in a directory listing.
- **`From:` and `Saved:` are mandatory.** Never write a favourite file without both.
- **Only include the tiers that actually fired**, worded as the Study section requires — a
  tier-3 inference written as a tier-1 fact is a lie that survives in a file.
- Omit a section entirely rather than writing an empty one.

**Markdown, not JSON, and this is deliberate:** Matt can read it, correct it by hand, and
diff it in git; it survives this tool being uninstalled; and no index only the tool can read
holds his decisions hostage. The cost is that nothing machine-queries it — pay it.

### Seeding a design language

If his project has no design document, `templates/design-language.md` next to this file is a
neutral seed — sections and prompts only, every one marked **Not yet decided**, with no
framework, stack or colour values assumed. Copy it in. **Tell him you created it** — do not
silently add a file to his repo. `overlay.test.cjs` asserts the template stays stack-neutral;
portability is a product constraint, not a style preference.

## Promote — a favourite becomes a decision

This is the step that makes a design language instead of a scrapbook, and it is the one part
of this tool where **you must not decide anything.** You lay out the collision and the
numbers; Matt picks. Work through one favourite at a time.

**1. Find the target document.** Look for his project's existing design doc — a
`DESIGN-LANGUAGE.md`, `design-system.md`, `STYLE.md`, a design section in the README,
whatever it's actually called. **That file is the target**, however it's laid out.
If there genuinely isn't one, copy `templates/design-language.md` in and **tell him you
created it, and where.** Never add a file to his repo silently.

**2. Get both sides into the same shape.** The classifier compares
`{ category: [values] }` against `{ category: [values] }` — same keys on both sides. Build
the study side from the favourite's `element.nonDefault` (`borderRadius` → `radii`, `padding`
and `gap` → `spacing`, `boxShadow` → `shadows`, `fontSize` → `typeScale`), and the language
side by reading his document's tables. A category his document has no section for is just an
empty array — the classifier resolves that to "new" on its own.

**Drop the absent values first** — `core.isAbsentValue(v)` is there for it. The style read
answers every property whether the site's author set one or not, so a plain card hands back
`boxShadow: "none"` and `paddingTop: "0px"`. Fed straight in, those come back as tokens to
adopt, and you end up asking Matt to add "no shadow" to his design language. Filter, then
reconcile. (It's a caller-side filter on purpose: "no shadow, deliberately" is occasionally a
real decision, and only he can say which one this is.)

**Units are handled, mismatched units are not.** `"20px"` and `20` compare the same; a
multi-part value like `"0 8px 30px rgba(0,0,0,.12)"` stays one opaque token and can only
match exactly. But `"20rem"` against a px scale is reported **new**, not conflict — there is
no root font size to convert with, so a real collision between `20rem` and `320px` will be
missed. **Convert to one unit before comparing** if his document and the studied site
disagree.

**3. Run the classifier.** `core.js` is DOM-free, so run it in plain Node — no browser needed:
```bash
node -e '
  const core = require("<this skill dir>/overlay/core.js");
  const study = { radii: [20], spacing: [16, 24] };            // from the favourite
  const lang  = { radii: [6, 10, 16, 999], spacing: [4, 8, 16, 24, 32] };  // from his doc
  console.log(JSON.stringify(core.reconcile(study, lang), null, 2));
'
```
It returns `{ fits, adopt, conflicts }`; every studied value lands in **exactly one** bucket.

**4. `fits` — say nothing.** The value is already in his scale. There is no decision here, and
narrating it buries the two buckets that do need him.

**5. `adopt` — propose it, and name the section it lands in.** "This card's shadow is
`0 8px 30px rgb(0 0 0 / .12)`; your Shadows section is empty — add it as the first
elevation level?" One line, one question.

**6. `conflict` — lead with adapting, and say so in one line rather than asking three.**

**This is inspiration, not transcription** (Matt's ruling, 2026-08-07). He is saying "I like
that card's corners, use it as a starting point" — not "reproduce this site". So when a
studied value lands near something he already has, **the expected outcome is that it snaps to
his value**, and treating that as a decision to be adjudicated is what turns a useful tool
into a nagging one. Report it, don't interrogate him:

> Its radius is **20px**; snapped to your existing **16px** (4px apart).

That is a statement he can override, not a question blocking the work. **Only stop and lay
out the choice when the difference looks deliberate** — a value that is close but where the
*source* clearly treats it as a distinct size (it appears repeatedly across the studied page,
or its own sweep shows both values in one scale). Then, and only then:

> - **Adapt** — use your existing 16px. The 4px goes.
> - **Adopt** — add 20px and retire 16px everywhere it is used today.
> - **Exception** — keep 16px as the rule, record this one as deliberate, with the reason.

**Still never choose the adopt-or-exception branch for him.** Snapping is the safe default
because it is reversible and leaves his system unchanged; changing or forking his scale is
neither, and stays his call.

The band was relaxed to 0.25 for exactly this reason — see `classifyValue`. A value 8px from
his nearest token is now simply a different size, not a collision.

**7. Write it into the right section.** Into Radii, under Radii. **Never append to the bottom
of his document** — a design doc that grows by accretion stops being read, which defeats the
whole point. Carry two things with every entry: **why** it was chosen and the **source URL**
from the favourite. A value with no reason is indistinguishable next year from one someone
typed by accident.

**8. If his document's tokens are asserted by tests** (`tests/design/`, a token snapshot, a
Tailwind config that mirrors the doc), **say so before you write**, and change them in the
same commit. Promoting a token and leaving its test red hands him a broken suite for a
change he approved.

## Watch loop

Repeat until Matt says done (or the browser closes / evaluate errors):

1. **Long-poll (self-healing)** for comments — one `browser_evaluate`:
   ```
   async () => {
     if (!window.__annotator) {
       const bootUrl = localStorage.getItem("__ann_boot_url");
       if (!bootUrl) return { needReinject: true };
       <contents of overlay.js>
       await window.__annotatorBoot(bootUrl);
     }
     if (!window.__annotator) return { needReinject: true };
     const anns = await window.__annotatorWait(25000);
     return { anns, perf: window.__annotatorPerfTake ? window.__annotatorPerfTake() : [] };
   }
   ```
   A page reload wipes all page JS state, including `__annotatorBoot` itself — so the
   self-heal has to re-embed the loader (the same ~37 lines from Setup step 4, not the
   whole implementation) *before* it can call it. `__annotatorBoot` then re-fetches the
   eight modules from the server you started in Setup step 2 (still running — it's a plain
   Node process, not tied to the page) and re-boots against the URL the overlay saved to
   `localStorage["__ann_boot_url"]` on first boot, restoring every annotation and its
   status from the same storage. Playwright awaits the promise; it returns the new
   annotations (the moment Matt saves one, or `[]` after ~25s).

   `{ needReinject: true }` and a **thrown/errored `browser_evaluate` call** are two
   different signals — don't conflate them:
   - **`{ needReinject: true }`** means only "no boot URL was ever saved" (fresh page,
     nothing booted yet this session) — recover by running Setup steps 2–4 from scratch.
   - **The `browser_evaluate` call itself erroring** (no return value at all) most often
     means the page **navigated or reloaded while the 25s poll was open** — routine during
     a long poll against an app Matt is actively editing (an HMR reload mid-evaluate kills
     it with a navigation error while the server is perfectly healthy). **Re-run the same
     poll first** — the reload self-heal (above) re-embeds the loader and picks up where it
     left off. Only if it **errors again immediately** should you suspect the `fetch` inside
     `__annotatorBoot` failed because the server from Setup step 2 is down or unreachable —
     `boot()` has no `catch` (deliberately — no retry/error-handling logic is built into it),
     so a dead server surfaces as a rejected promise / tool error, not as
     `{ needReinject: true }`. Only then restart the server and re-run Setup steps 2–4.
     Treating every errored evaluate as a dead server is the wrong call in the common case —
     it burns a server restart on a reload that would have self-healed on its own, and if the
     old server was still bound to a fixed port it would fail to restart at all.
2. **For each annotation in `anns`** `{ id, n, selector, descriptor, comment, url, hasImage }`:
   - **If `hasImage`, pull Matt's attachment FIRST** — it's the most direct statement of
     what he means. **Never return the image through the poll or a plain evaluate**: a
     screenshot is ~100k+ tokens of base64 and would swamp the context. Route it
     browser → disk → `Read`, using `browser_evaluate`'s `filename` param so the result
     never enters the transcript:
     ```
     browser_evaluate({
       function: '() => window.__annotatorImageTake("<id>")',
       filename: 'ann-<id>.b64.txt'      // only the PATH comes back, never the data
     })
     ```
     `filename` must sit **inside the repo** (or `.playwright-mcp/`) — the scratchpad under
     `/private/tmp` is outside Playwright's allowed roots and the write is refused. A bare
     name lands in the repo root; delete it when done.
     Then decode and view it (the file holds a JSON-quoted `data:image/jpeg;base64,…`):
     ```
     python3 -c "import json,base64,sys,pathlib
     raw=pathlib.Path(sys.argv[1]).read_text().strip()
     s=json.loads(raw) if raw.startswith('\"') else raw
     pathlib.Path(sys.argv[2]).write_bytes(base64.b64decode(s.split(',',1)[1]))" IN.b64.txt OUT.jpg
     ```
     and `Read` the `.jpg`. `__annotatorImageTake` is **read-and-forget**, but the most
     recent image stays retrievable until the next take — so if the write fails (bad path,
     tool error) just call it again with the same id. Fetch it before you start fixing.
   - **Screenshot it**: `browser_evaluate` → `() => window.__annotatorReveal("<id>")`
     (scrolls it into view), then `browser_take_screenshot`. The `#n` badge is visible
     in the shot, so annotation `n` ↔ badge `n`. View it for visual context.
   - **Find the source**: if `descriptor.source` is set (React dev `_debugSource`), go
     straight to that `file:line`. Otherwise grep for `descriptor.text`,
     `descriptor.className`, or a `data-*`/`aria-label` from `descriptor.attrs`, scoped
     by `url` (which route/page it's on). Confident → fix. Two candidates → show Matt, he picks.
   - **Fix or queue**: process in the order returned (Save order). If you're mid-fix when
     a batch arrives, finish the current one first, then the rest — tell Matt what you're
     on and what's queued.
3. **If the batch was empty** (timeout) 4–5 times in a row (~2 min quiet), pause and ask
   Matt if he's still going, rather than looping forever.

## Notes / ceilings

- The overlay is **session-ephemeral** (mirrored to `localStorage` only). Nothing is
  stored server-side. This is the intended "quick tool" tradeoff.
- **Leaving the mode (clicking the active tab, or Alt+A) while a comment box is open discards the typed
  text.** `disable()` closes the box on the way out; this is intentional, not a bug — the
  box's own Escape handler only exists while the mode is enabled, so leaving the box open
  across a mode switch would make it un-closable. Save or Cancel before toggling off.
- Screenshots are **process-time**, not save-time — a purely transient state (hover-only
  tooltip, a dropdown that closed) may not re-show; the text comment carries those.
- While mode is **ON**, the overlay swallows `pointerdown`/`mousedown`/`click`/`auxclick`
  on page elements so a click can't navigate (links/buttons are inert until you flip OFF) —
  that's what lets you click a hyperlink to comment on it without being taken to its target.
  **Hold Shift** to bypass this for one interaction (peek/click-through).
- **Reload-proof**: on setup the overlay writes the server URL (not any source) to
  `localStorage["__ann_boot_url"]`; the watch-loop poll re-embeds the loader and calls
  `__annotatorBoot` with that URL after a reload. Editing a component the current page
  uses often triggers an HMR reload — the self-heal handles it, as long as the server
  from Setup step 2 is still running.
- **Hover inspector**: while ON, hovering shows a computed-style card (tag, size, font,
  weight, color, bg, padding, margin) so Matt has DevTools-level context while commenting.
- **Attached images** are downscaled to 1600px on the longest side and stored as JPEG
  under their OWN `localStorage` key (`__ann_img_<id>`), never inside the `__annotations`
  blob — one raw Retina paste can exceed the whole quota, and a throwing write there
  would silently stop persisting every annotation. An in-memory map backs it up when the
  quota refuses. Ceiling: an image only survives a page reload if it fit in localStorage;
  the text comment always survives, so a lost attachment degrades, never blocks.
- The overlay UI derives its own palette at runtime from the **host page's computed**
  background and text colors (`getComputedStyle` + `color-mix`, see `overlay/palette.js`),
  plus one fixed accent color — it does not read any app's design tokens or CSS variables.
  That's what lets it look native on any site it's dropped into, light or dark, standalone
  from whatever design system (if any) the host page uses.
- **Never add an `<input type="file">` to the overlay.** This browser is Playwright-driven:
  Chrome hands the file chooser to the automation client instead of opening the OS dialog,
  so Matt sees nothing, and every queued chooser makes your next tool call fail with
  `does not handle the modal state` until you cancel them one by one (`browser_file_upload`
  with no paths). Clipboard paste and drag-and-drop both avoid the chooser. `overlay.test.cjs`
  asserts this. Same trap fires if Matt clicks an upload control in the *app* while you're
  driving — if a call dies on modal state, cancel the choosers and carry on.
- Never edit the Tideswell app to support this tool; all behavior lives in `overlay.js`
  and the modules it loads from `overlay/`.
- **This plugin repo is the only edit surface.** `.claude/skills/annotate/` inside a
  consuming project is a copy, is gitignored there, and must never be edited — the
  copy drifted for two days once, silently missing an entire feature. To refresh a
  consumer, re-install the plugin.
