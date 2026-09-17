---
name: annotate
description: Point-and-comment on the live local app, plus a read-only Study mode that reverse-engineers any site's design system. Invoked as /annotate [url]. Opens the Playwright browser, injects an inspect-element-style overlay so Matt can hover, click, and leave comments (each auto-screenshotted), then watches for those comments and fixes them. Study mode (the 4th toolbar tab) works against any URL, not just the local app, and never modifies the page it inspects. Studied elements can be favourited to a design-studies/ library and promoted, through a reconcile step, into the user's own design language. Fonts mode (the 5th tab) swaps fonts live on the page so font pairings can be previewed on the real product. Dev tool only — never shipped, exempt from mobile-parity.
---

# /annotate — point-and-comment on the live app

Matt marks up the running app visually; the comments flow back here to be fixed.
This skill is the loop **you** run. The implementation is the eight modules in `overlay/`,
injected into the page from disk by the Playwright process — so nothing is pasted through
your context and nothing is fetched over the network.

## Setup

1. **URL**: use the `[url]` arg, else `http://localhost:3000`. Assume the dev server
   is already up (Matt keeps `:3000` running — never kill it). If it's not, ask. **If the
   `[url]` arg is a remote address** (e.g. `/annotate https://someothersite.com`), there is
   no local dev server to wait for — that's a normal invocation, most often heading for
   Study mode (see below), which is built to work against any site, not just the local app.
2. **Open the page**: `browser_navigate` to the URL (reuse the existing browser).
3. **Boot the overlay** — one call, no server, no pasted source:
   ```
   browser_run_code_unsafe({ code: `async (page) => {
     const FILES = ["core.js","palette.js","fontpicker.js","fontspanel.js","ui.js","point.js","measure.js","study-motion.js","study.js","fonts.js","index.js"];
     for (const f of FILES) await page.context().addInitScript({ path: "<this skill's directory>/overlay/" + f });
     try { await page.context().grantPermissions(["local-fonts"]); } catch (e) {}
     try { await page.context().exposeBinding("__annotatorShoot", async ({ page }) => "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64")); } catch (e) {}
     await page.reload({ waitUntil: "domcontentloaded" });
     return await page.evaluate(() => { window.__annotatorMods.index.setup(); return "ready"; });
   }` })
   ```
   **`grantPermissions(["local-fonts"])` is what makes Fonts mode see the machine's real font
   library** — 449 families here rather than the 43 a measurement probe can find. It is wrapped
   in a try/catch because it is not worth failing the boot over: without it Fonts falls back to
   a curated list and says so in the picker. Everything else works either way.

   `addInitScript` takes a **path**, so Playwright reads the files in its own process and
   injects them over CDP before the document's own scripts — the same mechanism as
   `browser_evaluate`, which Chromium does not subject to page CSP. Verified booting on
   `github.com` under `default-src 'none'`, and on `stripe.com`, `linear.app` and localhost.
   Order matters: it is a dependency chain, and `overlay.test.cjs` asserts this list matches
   `core.js`'s `OWN_MODULE_FILES` and the directory itself.

   **What NOT to try** — all four fail, and are recorded so nobody loses an afternoon
   rediscovering them. `browser_run_code_unsafe` runs the snippet in a bare `vm` sandbox whose
   only host object is `page`: no `require` ("require is not defined"), no dynamic `import`
   ("a dynamic import callback was not specified"), and `page.addScriptTag({ path })` is
   refused by CSP **both with and without** a CDP `Page.setBypassCSP` — the bypass does not
   apply to a document that has already loaded.

   **Two costs.** It **reloads the page**, so boot before Matt starts rather than mid-session.
   And `browser_run_code_unsafe` is RCE-equivalent, so the harness may prompt each time. In
   exchange `addInitScript` persists for the browser context, so every later navigation
   re-injects the modules on its own.

   **The fallback boot path below does not grant `local-fonts`** — it has no access to the
   Playwright context — so Fonts mode will open on the curated list. That is recoverable: the
   picker's **Use my installed fonts** button asks for the permission directly.

   **If that tool is unavailable or refused**, the fallback is to read the eight files and
   `browser_evaluate` each one's contents in order, then call `index.setup()`. It works
   everywhere the first one does, but it costs ~24k tokens of your context per boot, which is
   exactly what the retired server existed to avoid. Say you are doing it and why.
4. *(nothing — the boot above is a single step)*
5. **Tell Matt**, briefly: a toolbar sits **bottom-centre**, and it **starts with no mode
   selected** (browse freely). Top row never changes — **Point · Measure · Compare · Study · Fonts**,
   then **Queue**; the second row shows whatever the selected mode needs and collapses when
   nothing is selected. **Click the mode you want** (no cycling), or press **Alt+A** to
   rotate through the modes and back to `off`. **Clicking the mode you are already in
   leaves it**, which is how you get back to using the page.
   - **Point** — hover highlights the element **and shows an inspector card** (computed
     font/size/color/padding/etc.), click opens a comment box, **⌘/Ctrl+Enter** or **Save**
     submits. The screenshot is taken **the instant he clicks**, before the box opens, so a
     tooltip or an open dropdown is in it. In the box, **↑ / ↓** (or **Alt+↑ / Alt+↓**) move
     the comment to the parent element and back, for when the click landed on a `<span>`
     inside the thing he means. **⌘/Ctrl+click** gathers several elements into one comment
     (dashed outlines; Escape drops them). He can also **⌘V a screenshot** of his own (⌃⌘⇧4
     copies one straight to the clipboard) or **drag an image file onto the box** from Finder
     — a thumbnail confirms it, ✕ removes it. **Hold Shift to "peek"** — click through for one
     action (open a dropdown/modal) without leaving the mode.
   - **Measure** — records timings, clicks pass straight through (see below).
   - **Compare** — baseline vs re-run. Save a run, let the agent work, run the same journey
     again, see what moved. See the Compare section below.
   - **Study** — reverse-engineers styles/design-system/motion, read-only, works on any
     site. Row 2 holds the note/tags/★ Save favourite inputs.
   - **Fonts** — click text, retype its font, see the pairing on the real page. This is the
     one mode that **writes to the page** (inline styles only, fully revertible). See below.

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

Row 2 shows the running entry count and a **Mark** field: type what just felt slow and press
Enter or **Mark**, or press **Alt+M** for an unlabelled mark. From the agent side:
`() => window.__annotatorMark("label")` (returns the entry, or `null` when Measure is off).

Entries come back on the same poll, in `perf`. Each has `t` (ms since page load):

| kind | fields | what it tells you |
|------|--------|-------------------|
| `nav` | `from`, `to`, `servedFromCache`, `rscMs`, `ttfbMs`, `serverTiming`, `toPaintMs` | Client-side route change. `servedFromCache: true` means the click needed **no** server request. Detected from the browser's own resource timings by looking **backward** for a `?_rsc=` request — Next starts that request *before* it pushes the URL, and does not route it through `window.fetch`. **`ttfbMs` is the server's think time** (request sent to first byte); `rscMs` also includes the download. `serverTiming` is the app's `Server-Timing` header as `[{ name, ms, desc }]`, or `null` when it sends none (Tideswell sends none). |
| `action` | `url`, `ms`, `ok` | A Server Action (e.g. sending a message), spotted by its `Next-Action` header. `ms` is time to response headers — the server's thinking time. |
| `img` | `url`, `ms`, `ttfbMs`, `transferSize`, `decodedBodySize`, `status`, `serverTiming` | A chat attachment. **`ms` is the trustworthy field** — it covers the whole two-hop redirect. `ttfbMs`, `transferSize`, `decodedBodySize` and `status` read `0` whenever the request redirects cross-origin to storage, because that origin sends no `Timing-Allow-Origin` header. Do not read `transferSize: 0` as a cache hit here. |
| `lcp` | `url`, `ms`, `size`, `element` | Largest contentful paint of the **page load** — when the main content appeared. One per recording, read from the browser's buffer, so it is there even though recording started after load. |
| `mark` | `label` | Matt (or you) marking a moment. Not a measurement: read the entries whose `t` sits just before it. Compare ignores marks. |
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
LCP describes the hard page load only: client-side navigations produce none. If the watch
loop drains the `lcp` entry before a later, larger paint lands, you keep the earlier value.
Actions have no `ttfbMs`: their resource timing is only written once the body has been read,
which is after the point `ms` measures.

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

  **The escape hatch, verified working 2026-08-07:** skip the network entirely.
  `browser_run_code_unsafe` runs your snippet in a **bare `vm` sandbox whose only host object
  is `page`** — no `require`, no `fs`, no dynamic `import`. Anything file-shaped must therefore
  go through `page` itself, and `addInitScript` takes a **path**, so Playwright reads the files
  in its own process and injects them over CDP before the document's own scripts — the same
  mechanism as `browser_evaluate`, which Chromium does not subject to page CSP.
  ```
  browser_run_code_unsafe({ code: `async (page) => {
    const FILES = ["core.js","palette.js","fontpicker.js","fontspanel.js","ui.js","point.js","measure.js","study-motion.js","study.js","fonts.js","index.js"];
    for (const f of FILES) await page.context().addInitScript({ path: "<this skill's directory>/overlay/" + f });
    try { await page.context().grantPermissions(["local-fonts"]); } catch (e) {}
    try { await page.context().exposeBinding("__annotatorShoot", async ({ page }) => "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64")); } catch (e) {}
    await page.reload({ waitUntil: "domcontentloaded" });
    return await page.evaluate(() => { window.__annotatorMods.index.setup(); return "ready"; });
  }` })
  ```
  Confirmed booting on `github.com` (`default-src 'none'`), `stripe.com` and `linear.app`,
  run inside a reproduction of that exact sandbox. **Four other approaches were tried and all
  fail** — recorded so nobody spends the afternoon again: `await import("node:fs/promises")`
  ("a dynamic import callback was not specified"), `require("fs")` ("require is not defined"),
  and `page.addScriptTag({ path })` **both with and without** a CDP `Page.setBypassCSP`
  ("Executing inline script violates the following Content Security Policy directive"). The
  CSP bypass does not rescue `addScriptTag`, because the policy belongs to the document that
  has already loaded.

  **Two real costs.** It needs a **page reload**, so anything typed or opened on that page is
  lost — boot before the user starts, never mid-session. And `browser_run_code_unsafe` is
  RCE-equivalent, so the harness may prompt for permission each time. In exchange,
  `addInitScript` persists for the browser context, so every later navigation re-injects the
  modules by itself and the watch loop's self-heal only has to call `index.setup()` again.
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

## Fonts mode

**Preview a font pairing on the real page, not on a specimen sheet.** Click a heading, click
a paragraph, retype both, and look at the actual product with the actual copy at the actual
sizes — which is the only place a pairing can honestly be judged.

**This is the one mode that writes to the page it is pointed at.** Study's read-only promise
is Study's, not the overlay's. Fonts writes **nine inline properties and nothing else** —
`font-family`, `font-weight`, `font-size`, `line-height`, `letter-spacing`, `word-spacing`,
`text-transform`, `font-style`, `font-variant-caps` — on elements it matched, snapshotting each
element's exact previous inline value and priority first. **Reset** puts every one of them
back, and a page reload clears them too. It skips our own chrome (`.__ann-ui`) so the toolbar
cannot restyle itself.

That list is a single array in `fonts.js` (`TOUCHED`), and `overlay.test.cjs` asserts every
property the mode writes appears in it. A property written but not snapshotted is a change
that outlives Reset with nothing on screen to say so — the one promise this mode cannot break.

**Driving it:**
1. Click **Fonts** in the toolbar.
2. **Click any text on the page.** The cursor is a crosshair while Fonts is picking. The
   overlay adds a **card** for that element **plus the elements like it in the same div**
   (same tag, same classes, same font), showing how many it holds. Clicking a nav link picks
   that nav's links, not every element on the page in that font. **Every element in that card's group stays outlined** so the count is something you can
   see rather than take on trust; the outline follows the newest pick and clears when you
   leave the mode. **Alt+click** to pick a link or button without the
   page navigating away (same convention as Study; plain click stops nothing, Shift skips).
3. **Press the card's font button** to open the picker. Every row in it is **set in the font
   it names** — that is the whole reason it is not a native dropdown, which would render all
   82 options in the browser's UI font. Type to search (a prefix match ranks above a match
   buried mid-name), filter by **All / On this Mac / Google**, ↑↓ and Enter work, Esc closes.
   Rows tagged `web` are fetched from Google the moment they scroll into view, one family at
   a time. The weight dropdown beside the button is `keep` by default, and **↺ puts the
   page's own font back** without removing the card.
4. **Press `Type ▾` for the rest of the suite.** Case (Original / UPPER / lower / Title),
   size, leading, tracking, word spacing, weight, italic, small caps. One card expands at a
   time. Sliders act **while you drag** — that is the point — and each opens on the value the
   element you clicked already has, so the first nudge is an adjustment rather than a jump.
   `↺` beside a slider puts that one property back; **Reset type** puts the whole card's type
   back while keeping the font you picked.
5. **Two cards is a pairing.** That is the shape to aim for: one for the headings, one for
   the body, judged together on the real page.
6. **Swaps stay applied when you leave the mode**, deliberately — judging a pairing means
   scrolling and clicking through the app with the new fonts on, which is impossible from
   inside a mode that owns every click. **Reset** clears them.

**Size, leading and tracking are RELATIVE, and that is what makes them safe on a group.** A
card can cover several elements, and those elements are not always the same size — this page's
headings span 52px down to an 11px eyebrow. Writing one absolute size across them would
flatten the hierarchy you are trying to judge. So leading is written unitless, tracking and
word spacing in `em` (both already ratios of each element's own size), and **size is a
multiplier applied per element against the size it had before the card touched it**. Drag the
size slider twice and it scales from the page's own value both times; it never compounds.

**From the agent side** — synchronous, nothing is sampled:
```
() => window.__annotatorFontsTake()
```
```
{ url, fontsAvailable, swaps: [{ from, to, weight, count, source }] }
```
Each swap carries `from`, `to`, and every typographic setting that was actually changed —
`weight`, `sizeScale`, `lineHeight`, `tracking`, `wordSpacing`, `transform`, `italic`,
`smallCaps` — with `null` meaning "left as the page had it". **`css` is the same settings as a
ready-made declaration block**, so a decision can be pasted rather than retyped; its
`font-size` is the anchor element's, while `sizeScale` is the part that generalises across the
group. **`count` is the load-bearing field**: a swap that matched nothing and a swap that restyled 300 elements are
indistinguishable without it, and only the second one is a decision. Feed the result into the
promote step (Typography) exactly like a favourite — a pairing he liked on screen is
inspiration, not yet a decision.

**Where the fonts come from.** Installed fonts are enumerated with **`queryLocalFonts()`**,
which needs the `local-fonts` permission. The boot snippet grants it outright, so normally
there is no prompt. That is the difference between seeing your whole library and seeing a
guess: 449 families against 43 on this machine, measured 2026-08-20. The fallback is
**canvas width-measurement** over a fixed candidate list.

**If the list comes up short, the picker says why and offers the fix.** The permission used to
be obtainable only out of band — from `grantPermissions` in the boot snippet — so a session
that booted before that line existed, or through the fallback boot path below (which has no
grant), showed the curated set for ever with no way back. It can now be asked for from inside
the page, from Matt's own click, because the prompt appears in a browser window he is looking
at. Four causes produce the same short list, and the note distinguishes them:

| `fontAccess` | what the picker says | fixable in-page |
|---|---|---|
| `prompt` / `unknown` | "Your own fonts need the browser's permission" + **Use my installed fonts** | yes — click it |
| `denied` | blocked for this site; allow it in site settings, then **Retry** | after changing site settings |
| `insecure` | the page is plain `http`, so the browser hides the API entirely | no — needs `https` or `localhost` |
| `unsupported` | this browser cannot list installed fonts | no |

`__annotatorFontsTake()` reports both `fontsFrom: "system" | "probed"` and `fontAccess`, so a
session that cannot see the picker can still say what is wrong. **The button's click path must
stay synchronous down to `queryLocalFonts()`** — Chrome only shows the prompt while the user
activation from that click is live, and one `await` on the way in spends it. `overlay.test.cjs`
asserts there is no `await` in that path; the failure mode is invisible, because the prompt
simply never appears.

The web list is ~40 curated pairing families, hard-coded: the Google Fonts *catalogue* API
needs a key, and a key in a dev tool is a key in a git repo. A web family you already own is
offered as `local`, so it needs no network at all.

**Honest limits — report these, don't paper over them:**
- **A site that blocks Google Fonts blocks the web half.** On `github.com` (`default-src
  'none'`) the stylesheet is refused; the row says so in its own line rather than silently
  doing nothing, and **installed fonts still work there**. A blocked stylesheet does not throw
  — `document.fonts.load()` resolves with an empty face list, which is what that check reads.
- **A re-render undoes the swap for the elements it replaced.** Inline styles live on the
  nodes; React handing back fresh nodes hands back the original font. Re-pick the row to
  re-apply. A `MutationObserver` would fix it and is not worth it for a preview tool.
- **Grouping is by computed font, so a page set in one font everywhere gives one card.** That
  is the honest answer — there is no second font to pair against yet.
- **Only on the fallback path is the list incomplete.** With `local-fonts` granted the picker
  shows every installed family. Without it, it shows what the probe list happens to name — and
  it says so at the foot of the picker, so "my font is missing" always has an answer.
- **"Like it" means an exact tag and class match.** A nav link with an extra `active` class
  won't join its siblings; click it separately to get its own card.
- **Shadow DOM isn't walked**, same as Study.

## Compare mode

**Prove the fix worked.** Record a journey in Measure, save it as a baseline, let the agent
change something, run the *same* journey again, and read the delta. This exists because of two
recorded incidents in this project: measure mode's first version reported `servedFromCache:
true` for every navigation — the exact opposite of the truth — with all sixteen of its unit
tests passing; and a headline performance finding once evaporated because it had been measured
on the dev server. Before-and-after numbers are how that stops happening.

**The loop:**
1. **Measure** — drive the journey.
2. **Compare → Save baseline.** The baseline is written to `localStorage`, deliberately: the
   agent works in between, and editing a component the page uses triggers an HMR reload that
   would take an in-memory baseline with it.
3. Make the change.
4. **Measure** again — **selecting Measure resets the run**, so drive the same journey cleanly.
5. **Compare → Compare.** Tick **regressions only** to see just what got worse.

**From the agent side:**
```
() => window.__annotatorCompareSaveBaseline()   // { ok, entries } — after driving in Measure
() => window.__annotatorCompareTake()           // the full result
() => window.__annotatorCompareClearBaseline()
```
All three are **synchronous** — there is no sampling here, only arithmetic over entries already
recorded. `CompareTake` returns `{ rows, regressions, truncated, dropped, thresholds }`, or
`{ error: "no-baseline" }`. **It deliberately returns the whole result rather than just the
regressions**: a caller that only ever sees regressions cannot tell *"nothing got worse"* from
*"nothing was measured in both runs"*, and those need completely different answers to Matt.

**Each row is `{ key, kind, before, after, deltaMs, deltaPct, verdict, thin }`:**

| verdict | means |
|---|---|
| `slower` / `faster` | cleared **both** noise floors — at least 5ms **and** at least 10% |
| `same` | moved, but not enough to be real |
| `added` | only in the new run. Not a regression — you cannot regress against nothing |
| `gone` | only in the baseline. Not an improvement either |

**Report `thin: true` rows as anecdotes, not measurements.** It means one side had a single
sample. "38% faster" off one observation each is exactly the shape of the finding that
evaporated on a prod build — say "one sample each way" out loud rather than quoting the
percentage as if it were stable.

**`truncated: true` means entries were dropped** (the 500-entry cap) and the two runs are not
comparable like for like. Pass that on; never present a truncated comparison as a complete one.

**How rows are paired.** Entries match across runs on `kind` plus a normalised path — origin,
query and hash stripped, because Next appends a fresh `?_rsc=<hash>` to every navigation and
leaving it on would mean *nothing* ever matched and every row read `added`. Navigations key on
the route **pair** (`/ -> /tasks`); layout shifts and long tasks have no identity of their own,
so they aggregate by kind.

**Ceilings.** Two runs of one journey is not a benchmark — it is a smoke test with numbers.
It catches a 30ms action becoming 300ms, which is the case it was built for; it will not settle
a 5% argument. And measure mode's own ceilings all apply (browser-side only, cross-origin
timings opaque, Next-specific navigation detection).

## Watch loop

Repeat until Matt says done (or the browser closes / evaluate errors):

1. **Long-poll (self-healing)** for comments — one `browser_evaluate`:
   ```
   async () => {
     if (!window.__annotatorMods) return { needReboot: true };
     if (!window.__annotator) window.__annotatorMods.index.setup();
     const anns = await window.__annotatorWait(25000);
     return { anns, perf: window.__annotatorPerfTake ? window.__annotatorPerfTake() : [] };
   }
   ```
   A page reload wipes all page JS state — but `addInitScript` persists for the browser
   context, so after any reload or navigation the eight modules are **already back**; only
   `setup()` needs calling again. That is the whole self-heal, and it is why the boot in
   Setup step 3 is a one-time cost rather than something the watch loop has to redo.

   `{ needReboot: true }` and a **thrown/errored `browser_evaluate` call** are different
   signals — don't conflate them:
   - **`{ needReboot: true }`** means the modules are not there at all: a different browser
     context, or the boot never ran this session. Re-run Setup step 3.
   - **The call itself erroring** (no return value) most often means the page **navigated or
     reloaded while the 25s poll was open** — routine while Matt edits an app with HMR.
     **Re-run the same poll first**; it will find the modules already re-injected and just
     call `setup()`. Only if it errors again immediately should you re-run Setup step 3.

2. **For each annotation in `anns`** `{ id, n, selector, descriptor, others, comment, url, hasImage, hasShot, context }`:
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
   - **Look at what he saw**: if `hasShot`, pull the click-time screenshot exactly like an
     attachment, with id `"<id>-shot"` (`__annotatorImageTake("<id>-shot")` through
     `browser_evaluate`'s `filename`, never inline). It was taken the moment he clicked, so
     tooltips and open menus are in it; the highlight ring marks what he clicked, and earlier
     `#n` badges on the page are visible too. If `hasShot` is false (the fallback boot path
     has no screenshot binding), fall back to `() => window.__annotatorReveal("<id>")` then
     `browser_take_screenshot`.
   - **Find the source**: `descriptor.source` is `{ file, line, column, via, usedFrom }`,
     already the nearest file in the app's own code (library components are skipped).
     **`usedFrom` is the next two app files up the tree, and it matters:** the nearest file is
     often a shared wrapper (the login email field resolves to `src/components/ui/input.tsx`),
     while a comment like "make this wider" usually means the file that placed *this* instance
     (`usedFrom[0]`, `src/components/auth/login-form.tsx:64`). Decide which one the comment is
     about before editing; changing the shared wrapper changes every input in the app.
     `via: "next-dev"` means Next's dev server resolved it, which only happens on a Next App
     Router dev server. If `source` is `null`, grep for the component:
     `descriptor.components` lists the owning components nearest first, so
     `function <components[0]>` or `const <components[0]>` usually finds the file. After that,
     `descriptor.text`, `descriptor.className`, or a `data-*`/`aria-label` from
     `descriptor.attrs`, scoped by `url`. Confident → fix. Two candidates → show Matt, he picks.
   - **`others`** (⌘-click) is the same `{ selector, descriptor }` for each extra element. One
     comment, several places: fix them together.
   - **`context`** is `{ windowMs, errors, failedRequests }`: the page's `console.error`s,
     uncaught errors, rejected promises, and failed `fetch`/image/script loads **in the 30
     seconds before he saved**. Page-wide, not per element. When it is non-empty, read it
     before guessing at a cause. XHR failures are not captured.
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
- While mode is **ON**, the overlay swallows `pointerdown`/`mousedown`/`click`/`auxclick`
  on page elements so a click can't navigate (links/buttons are inert until you flip OFF) —
  that's what lets you click a hyperlink to comment on it without being taken to its target.
  **Hold Shift** to bypass this for one interaction (peek/click-through).
- **Reload-proof, for free**: `addInitScript` is registered on the browser *context*, so the
  eight modules are re-injected into every subsequent document automatically. After an HMR
  reload the watch-loop poll only has to call `index.setup()` again. There is no server to
  stay running and no URL to remember — both were retired 2026-08-07.
- **Hover inspector**: while ON, hovering shows a computed-style card (tag, size, font,
  weight, color, bg, padding, margin) so Matt has DevTools-level context while commenting.
- **Attached images** are downscaled to 1600px on the longest side and stored as JPEG
  under their OWN `localStorage` key (`__ann_img_<id>`), never inside the `__annotations`
  blob — one raw Retina paste can exceed the whole quota, and a throwing write there
  would silently stop persisting every annotation. An in-memory map backs it up when the
  quota refuses. Ceiling: an image only survives a page reload if it fit in localStorage;
  the text comment always survives, so a lost attachment degrades, never blocks.
- **The overlay chrome is a fixed dark theme in one typeface** (`overlay/palette.js`). It used
  to derive its colours at runtime from the host page's computed background and text, so it
  looked native wherever it landed; Matt's call 2026-08-20 was to hardcode it, because a
  chrome that changes colour depending on the site is a chrome you re-read every time. A dark
  panel with a real border and shadow reads as *the tool, not the page* on a white site and a
  black one alike. It still reads no app's design tokens or CSS variables.
  - **Geist for everything, and there is no monospace face.** Geist is **not installed** on
    this machine, so `ui.js` loads it from Google once per page; the stack falls back to
    `system-ui` until it arrives, or permanently on a site whose CSP refuses the request —
    this is chrome, not content, so a missing typeface costs looks and nothing else. The
    column alignment the old monospace bought now comes from `font-variant-numeric:
    tabular-nums`, set once over the whole chrome.
  - The muted tones are chosen **by measured contrast, not by eye** — `text3` carries the
    10–11px control labels, and its first hand-picked value came in at 3.08:1 against a card.
    `overlay.test.cjs` computes every ink-on-surface pair and fails below 4.5:1.
- **Never add an `<input type="file">` to the overlay.** This browser is Playwright-driven:
  Chrome hands the file chooser to the automation client instead of opening the OS dialog,
  so Matt sees nothing, and every queued chooser makes your next tool call fail with
  `does not handle the modal state` until you cancel them one by one (`browser_file_upload`
  with no paths). Clipboard paste and drag-and-drop both avoid the chooser. `overlay.test.cjs`
  asserts this. Same trap fires if Matt clicks an upload control in the *app* while you're
  driving — if a call dies on modal state, cancel the choosers and carry on.
- Never edit the Tideswell app to support this tool; all behavior lives in `overlay/`.
- **This plugin repo is the only edit surface.** `.claude/skills/annotate/` inside a
  consuming project is a copy, is gitignored there, and must never be edited — the
  copy drifted for two days once, silently missing an entire feature. To refresh a
  consumer, re-install the plugin.
- **Voice was dropped** (2026-09-17, spec §6.1's timebox). Tideswell sends
  `Permissions-Policy: microphone=()`, which forbids microphone access on every page of the
  app Point exists for, so no in-page recorder can work there. macOS Dictation types into any
  focused text field, the comment box included, with no code from this tool.
- **A comment reaches the agent up to 1.5s after Save.** It is saved and badged at once, then
  held back (`status: "resolving"`) until its source lookup settles. A reload in that window
  hands it over without a source, never loses it.
