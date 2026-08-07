// Self-check for the one piece of tricky logic in overlay.js: buildSelector.
// Pure helpers now live in overlay/core.js and are required directly; overlay.js
// itself is now just the loader (Task 6) — its source is still read (never
// executed here) for the file-input regression guard and the loader's own checks.
// Run: node skills/annotate/overlay.test.cjs
const fs = require("node:fs");
const assert = require("node:assert");

const src = fs.readFileSync(__dirname + "/overlay.js", "utf8");

// Modules are loaded individually so a break is attributed to one file.
const path = require("node:path");
const MOD = function (name) { return path.join(__dirname, "overlay", name); };
const core = require(MOD("core.js"));

assert.strictEqual(typeof core.buildSelector, "function", "core exports buildSelector");
assert.strictEqual(typeof core.fitDimensions, "function", "core exports fitDimensions");
assert.strictEqual(typeof core.classifyRequest, "function", "core exports classifyRequest");
assert.strictEqual(typeof core.createPerfBuffer, "function", "core exports createPerfBuffer");
assert.strictEqual(typeof core.findRscEntry, "function", "core exports findRscEntry");

// core must be DOM-free: it is required in Node with no browser globals present.
// If it touches window/document at load time this require would already have thrown.
const coreSrc = fs.readFileSync(MOD("core.js"), "utf8");
assert.ok(!/getComputedStyle|document\.createElement/.test(coreSrc), "core.js stays DOM-free");

const { buildSelector, fitDimensions } = core;

// Fake DOM nodes: just what buildSelector reads.
function el(tag, id) { return { nodeType: 1, tagName: tag.toUpperCase(), id: id || "", parentElement: null, children: [] }; }
function child(parent, node) { node.parentElement = parent; parent.children.push(node); return node; }

const app = el("div", "app");
const ul = child(app, el("ul"));
child(ul, el("li"));                 // li #1
const li2 = child(ul, el("li"));     // li #2 (target)
child(ul, el("li"));                 // li #3

assert.strictEqual(buildSelector(li2), "#app > ul > li:nth-of-type(2)", "nth-of-type path + id anchor");
assert.strictEqual(buildSelector(el("section", "hero")), "#hero", "id short-circuits");
assert.strictEqual(buildSelector(null), "", "null -> empty");

// fitDimensions: the downscale that keeps a pasted screenshot inside the storage quota.
assert.deepStrictEqual(fitDimensions(3200, 2000, 1600), { w: 1600, h: 1000 }, "scales by the longest side");
assert.deepStrictEqual(fitDimensions(800, 4000, 1600), { w: 320, h: 1600 }, "tall images scale by height");
assert.deepStrictEqual(fitDimensions(900, 600, 1600), { w: 900, h: 600 }, "never upscales a small image");
assert.deepStrictEqual(fitDimensions(0, 100, 1600), { w: 0, h: 0 }, "degenerate size -> zero, no NaN canvas");
assert.deepStrictEqual(fitDimensions(4000, 1, 1600), { w: 1600, h: 1 }, "a sliver keeps at least 1px");

// Regression guard: an <input type="file"> must never come back. This browser is
// Playwright-driven — Chrome routes the chooser to the automation client, so Matt sees
// no dialog AND every queued chooser blocks the agent's next tool call. Paste + drop only.
assert.ok(!/\.type\s*=\s*["']file["']/.test(src), "no file input (its chooser jams the agent)");

// classifyRequest: which kind of Next.js request is this? Next tags Server Actions with
// `Next-Action` and RSC navigation payloads with `RSC`. Everything else is ignored.
const { classifyRequest, createPerfBuffer } = core;

assert.strictEqual(classifyRequest({ "Next-Action": "abc" }), "action", "Next-Action -> action");
assert.strictEqual(classifyRequest({ RSC: "1" }), "rsc", "RSC alone -> rsc");
assert.strictEqual(classifyRequest({ "Next-Action": "a", RSC: "1" }), "action", "both -> action (actions post from an RSC context)");
assert.strictEqual(classifyRequest({ "Content-Type": "application/json" }), null, "neither -> null");
assert.strictEqual(classifyRequest({ "next-action": "abc" }), "action", "plain-object lookup is case-insensitive");
assert.strictEqual(classifyRequest(null), null, "no headers -> null, never throws");
assert.strictEqual(classifyRequest(undefined), null, "undefined headers -> null");

// A Headers-like object (its own .get is already case-insensitive) must work too.
const fakeHeaders = { get: (n) => (n.toLowerCase() === "rsc" ? "1" : null) };
assert.strictEqual(classifyRequest(fakeHeaders), "rsc", "Headers instance via .get()");

// createPerfBuffer: bounded FIFO. Truncation must never be silent.
const buf = createPerfBuffer(3);
assert.deepStrictEqual(buf.drain(0), [], "drain with nothing recorded -> []");

buf.push({ t: 1, kind: "img" });
buf.push({ t: 2, kind: "img" });
assert.strictEqual(buf.size(), 2, "size reflects pushes");
assert.deepStrictEqual(buf.drain(9), [{ t: 1, kind: "img" }, { t: 2, kind: "img" }], "drain returns entries in order");
assert.deepStrictEqual(buf.drain(9), [], "second drain is empty — drain clears");

// Overflow: cap 3, push 5 -> oldest two dropped, one dropped-entry prepended.
const buf2 = createPerfBuffer(3);
for (let i = 1; i <= 5; i++) buf2.push({ t: i, kind: "img" });
const out = buf2.drain(99);
assert.deepStrictEqual(out[0], { t: 99, kind: "dropped", n: 2 }, "dropped entry prepended with the count and drain time");
assert.deepStrictEqual(out.slice(1), [{ t: 3, kind: "img" }, { t: 4, kind: "img" }, { t: 5, kind: "img" }], "oldest dropped first, newest kept");
assert.deepStrictEqual(buf2.drain(100), [], "dropped counter resets after a drain");

// findRscEntry: did this navigation actually hit the server?
// Caught live 2026-08-04: Next marks RSC navigations with a `?_rsc=` QUERY PARAM and does not
// route them through the patched window.fetch — and it starts the request BEFORE pushState, so
// a forward-looking timer misses it entirely and every nav reads as a cache hit. Detection
// therefore reads the browser's own resource timings and looks BACKWARD from the URL change.
const { findRscEntry } = core;
const P = "/chat/c/abc";
const rscHit = { name: "http://x/chat/c/abc?_rsc=h4sh", startTime: 900, duration: 145 };

assert.strictEqual(findRscEntry([rscHit], "http://x/chat/c/abc", 1000, 1200), rscHit, "finds an _rsc request that started before the URL changed");
assert.strictEqual(findRscEntry([], "http://x/chat/c/abc", 1000, 1200), null, "no entries -> null (genuine cache hit)");
assert.strictEqual(findRscEntry([{ name: "http://x/chat/c/abc", startTime: 900, duration: 50 }], "http://x/chat/c/abc", 1000, 1200), null, "a same-path request WITHOUT _rsc is not a navigation payload");
assert.strictEqual(findRscEntry([{ name: "http://x/chat/c/OTHER?_rsc=h", startTime: 900, duration: 50 }], "http://x/chat/c/abc", 1000, 1200), null, "an _rsc for a different channel does not count");
assert.strictEqual(findRscEntry([{ name: "http://x/chat/c/abc?_rsc=h", startTime: 100, duration: 50 }], "http://x/chat/c/abc", 1000, 200), null, "an _rsc older than the lookback window is ignored");
assert.strictEqual(findRscEntry([rscHit], "http://x/chat/c/abc?m=123", 1000, 1200), rscHit, "query string on the destination is ignored when matching");
assert.strictEqual(findRscEntry(null, "http://x/chat/c/abc", 1000, 1200), null, "no entry list -> null, never throws");

const paletteSrc = fs.readFileSync(MOD("palette.js"), "utf8");
const uiSrc = fs.readFileSync(MOD("ui.js"), "utf8");

// The palette must keep deriving from the HOST page, not a hardcoded theme —
// this is what makes the overlay look native on whatever site it lands on.
assert.ok(/getComputedStyle/.test(paletteSrc), "palette derives from the host page");
assert.ok(/ACCENT/.test(paletteSrc), "palette keeps a fixed accent identity");

// Luminance is measured through a canvas on purpose: string-parsing misreads
// modern lab()/oklch() channel ranges. Guard the canvas path against being
// "simplified" back into a regex.
assert.ok(/getContext\(["']2d["']\)/.test(paletteSrc), "palette resolves colour via canvas, not string parsing");

// ui.js owns chrome only — no mode logic, no annotation records.
assert.ok(!/__annotations\b/.test(uiSrc), "ui.js does not touch annotation state");
assert.ok(!/mode\s*[!=]==?\s*["']on["']/.test(uiSrc), "ui.js does not branch on mode");

// The file-chooser ban and the mode-guard rule are overlay-wide invariants.
// They are re-asserted per module so a future split cannot quietly drop them.
for (const f of ["core.js", "palette.js", "ui.js"]) {
  const src = fs.readFileSync(MOD(f), "utf8");
  assert.ok(!/\.type\s*=\s*["']file["']/.test(src), "no file input in " + f + " (its chooser jams the agent)");
}

// Smoke-require both modules, mirroring the core.js check above. build() and create()
// need a DOM and can't be called here, but requiring ui.js exercises its
// require("./palette.js") path — a broken relative path or a missing export fails here,
// not on first injection into a live page.
const palette = require(MOD("palette.js"));
assert.strictEqual(typeof palette.build, "function", "palette exports build");
assert.strictEqual(typeof palette.SANS, "string", "palette exports SANS");
assert.strictEqual(typeof palette.MONO, "string", "palette exports MONO");

const ui = require(MOD("ui.js"));
assert.strictEqual(typeof ui.create, "function", "ui exports create");

// Task 5 consumes these key names literally; a silent rename here would break it with
// no test failing. Guard on the source text of each module's returned object.
const paletteKeys = ["elevated", "surface", "surface2", "hover", "border", "hairline", "text", "text2", "text3", "accent", "accentFg", "accentSoft"];
for (const k of paletteKeys) {
  assert.ok(new RegExp(k + "\\s*:").test(paletteSrc), "palette.build() return must include key " + k);
}
const uiKeys = ["showHighlight", "hideHighlight", "showInspector", "hideInspector", "bar", "pill", "guide", "help", "setPillLabel", "isOurs"];
for (const k of uiKeys) {
  assert.ok(new RegExp(k + "\\s*:").test(uiSrc), "ui.create() handles must include key " + k);
}

const pointSrc = fs.readFileSync(MOD("point.js"), "utf8");
const measureSrc = fs.readFileSync(MOD("measure.js"), "utf8");

// THE mode-guard invariant. With four modes coming, a guard rewritten as
// === "off" makes measure mode start swallowing clicks — silently.
const pointGuards = pointSrc.match(/mode\s*!==\s*["']on["']/g) || [];
assert.ok(pointGuards.length >= 4, "point.js keeps its mode !== 'on' guards, found " + pointGuards.length);
assert.ok(!/mode\s*===\s*["']off["']/.test(pointSrc), "no === 'off' guards (breaks with a third mode)");

// No file input, in every module that exists yet.
for (const f of ["point.js", "measure.js", "index.js"]) {
  const src = fs.readFileSync(MOD(f), "utf8");
  assert.ok(!/\.type\s*=\s*["']file["']/.test(src), "no file input in " + f + " (its chooser jams the agent)");
}

// Measure mode must stay passive: it wraps fetch but must always delegate.
// The first version of this recorder used a forward-only window and reported
// servedFromCache: true for every navigation — the exact opposite of the truth —
// with all 16 unit tests passing.
assert.ok(/origFetch/.test(measureSrc), "measure.js keeps the original fetch reference");
assert.ok(/history\.pushState/.test(measureSrc), "measure.js patches pushState");
assert.ok(/RSC_LOOKBACK_MS/.test(measureSrc), "measure.js keeps the backward lookback window");

// Images are stored per-annotation, never inside the __annotations blob: one
// Retina paste can exceed the whole quota and a throwing write would silently
// stop persisting every annotation.
assert.ok(/__ann_img_/.test(pointSrc), "point.js keeps per-annotation image keys");
assert.ok(/IMG_MAX_PX/.test(pointSrc), "point.js keeps the downscale cap");

// Smoke-require both new modules, mirroring the core/palette/ui checks above — a
// broken relative path or a missing export fails here, not on first injection.
const point = require(MOD("point.js"));
assert.strictEqual(typeof point.create, "function", "point exports create");

const measure = require(MOD("measure.js"));
assert.strictEqual(typeof measure.create, "function", "measure exports create");

const indexSrc = fs.readFileSync(MOD("index.js"), "utf8");

// The four window entry points the skill's watch loop calls. Renaming any of
// them breaks the agent silently — the poll just never returns anything.
for (const api of ["__annotatorDrain", "__annotatorWait", "__annotatorPerfTake", "__annotatorReveal", "__annotatorImageTake"]) {
  assert.ok(indexSrc.indexOf("window." + api) !== -1, "index.js still exposes " + api);
}

// The long-poll is woken directly by save(); a poll-interval-bound version
// would make every comment feel laggy.
assert.ok(/waiter/.test(indexSrc), "index.js keeps the one-shot waiter");
assert.ok(/25000/.test(indexSrc), "index.js keeps the 25s long-poll ceiling");

// The idempotent re-inject guard.
assert.ok(/if\s*\(\s*window\.__annotator\s*\)\s*return/.test(indexSrc), "index.js keeps the re-inject guard");

// The mode cycle must remain off -> on -> measure -> study -> off (Task 6 added the
// fourth mode). Guarded on the source since a rewritten cascade could silently drop
// straight back to off from measure instead of reaching study.
assert.ok(/"measure"\s*\?\s*"study"/.test(indexSrc) || /"study"\s*:\s*"off"/.test(indexSrc), "toggle must cycle through study before off");

// Smoke-require index.js, mirroring the other five modules — a broken
// relative path or a missing export fails here, not on first injection.
const indexMod = require(MOD("index.js"));
assert.strictEqual(typeof indexMod.setup, "function", "index exports setup");

const loaderSrc = fs.readFileSync(path.join(__dirname, "overlay.js"), "utf8");

// The old bootstrap concatenated Function.prototype.toString() of every
// closed-over helper, maintained by hand. It must be gone, not merely edited —
// a six-module split makes that list impossible to keep correct.
assert.ok(!/__ann_boot["']\s*,\s*\w+\.toString\(\)/.test(loaderSrc), "hand-concatenated bootstrap is gone");
assert.ok(/__ann_boot_url/.test(loaderSrc), "loader stores a re-fetch URL instead");

// Load order is a real dependency chain: core -> palette -> ui -> modes -> index.
// study.js requires study-motion.js, and index.js requires everything (Task 6).
const order = ["core.js", "palette.js", "ui.js", "point.js", "measure.js", "study-motion.js", "study.js", "index.js"];
let at = -1;
for (const f of order) {
  const i = loaderSrc.indexOf(f);
  assert.ok(i > at, "loader lists " + f + " in dependency order");
  at = i;
}

// core.js's OWN_MODULE_FILES and the loader's FILES are two hand-maintained
// lists that must name the same files — a ninth module added to one but not
// the other silently reintroduces the isOwnModuleUrl self-match bug (Study
// reporting its own new module as a detected motion/whatever library) for
// exactly the file that was left out. Extract each array literal and check
// membership rather than trusting them to stay in sync by convention.
function extractStringArray(src, varName) {
  const m = new RegExp(varName + "\\s*=\\s*\\[([^\\]]*)\\]").exec(src);
  if (!m) return [];
  return (m[1].match(/["']([^"']+)["']/g) || []).map(function (s) { return s.slice(1, -1); });
}
const loaderFiles = extractStringArray(loaderSrc, "FILES");
const ownModuleFiles = extractStringArray(coreSrc, "OWN_MODULE_FILES");
assert.ok(loaderFiles.length > 0, "loader's FILES array is parseable");
assert.ok(ownModuleFiles.length > 0, "core.js's OWN_MODULE_FILES array is parseable");
for (const f of loaderFiles) {
  assert.ok(ownModuleFiles.indexOf(f) !== -1,
    "loader FILES entry '" + f + "' is missing from core.js's OWN_MODULE_FILES");
}

// ---- Phase 1a: pure helpers behind Study ----------------------------------

// tallyValues: frequency order is what makes a palette readable — the colour
// used 400 times is the brand colour, the one used twice is an accident.
assert.deepStrictEqual(
  core.tallyValues(["a", "b", "a", "c", "a", "b"]),
  [{ value: "a", count: 3 }, { value: "b", count: 2 }, { value: "c", count: 1 }],
  "tallyValues sorts by frequency, descending"
);
assert.deepStrictEqual(core.tallyValues([]), [], "tallyValues handles empty input");

// detectScale: the single most useful fact about someone else's spacing is
// whether it is on a grid at all.
var s4 = core.detectScale([4, 8, 12, 16, 24, 32]);
assert.strictEqual(s4.base, 4, "detectScale finds a 4px base");
assert.strictEqual(s4.onGrid, true, "detectScale reports a clean 4px grid");

var s8 = core.detectScale([8, 16, 24, 48]);
assert.strictEqual(s8.base, 8, "detectScale finds an 8px base");

// A scale with an off-grid value must NOT be reported as on-grid — claiming a
// grid that isn't there is worse than reporting no grid.
var messy = core.detectScale([4, 8, 13, 16]);
assert.strictEqual(messy.onGrid, false, "one off-grid value breaks the grid claim");

// base >= 2 guard: a GCD of 1 is not a grid, it is arithmetic.
var noGrid = core.detectScale([3, 5, 7]);
assert.strictEqual(noGrid.onGrid, false, "gcd of 1 is not a grid");

assert.deepStrictEqual(core.detectScale([]), { base: 0, values: [], onGrid: false }, "detectScale handles empty");
assert.strictEqual(core.detectScale([0, 0, 16]).base, 16, "detectScale ignores zeros");

// toTailwind: exact utility where stock Tailwind has one, arbitrary value
// otherwise. Getting this backwards produces classes that silently do nothing.
var tw = core.toTailwind({ borderRadius: "16px", paddingTop: "24px", paddingRight: "24px",
                           paddingBottom: "24px", paddingLeft: "24px", display: "flex",
                           flexDirection: "column", gap: "12px" });
assert.ok(tw.indexOf("rounded-2xl") !== -1, "16px radius -> rounded-2xl, got " + tw.join(" "));
assert.ok(tw.indexOf("p-6") !== -1, "24px padding -> p-6, got " + tw.join(" "));
assert.ok(tw.indexOf("flex") !== -1 && tw.indexOf("flex-col") !== -1, "flex column");
assert.ok(tw.indexOf("gap-3") !== -1, "12px gap -> gap-3");

var twArb = core.toTailwind({ borderRadius: "13px" });
assert.ok(twArb.indexOf("rounded-[13px]") !== -1, "off-scale radius -> arbitrary value, got " + twArb.join(" "));

// A default value must produce NO class — emitting `static` or `flex-row` for
// every element buries the three classes that matter.
assert.deepStrictEqual(core.toTailwind({ display: "block", position: "static" }), [], "defaults emit nothing");

assert.strictEqual(typeof core.defaultsFor("div"), "object", "defaultsFor returns a table");
assert.strictEqual(core.defaultsFor("div").display, "block", "div defaults to display:block");

// ---- Fixes to Phase 1a functions -----------------------------------------------

// Fix 1: toTailwind must emit position when non-default (e.g. sticky).
// Previously: position was in BLOCK_DEFAULTS but never read from the style input.
assert.ok(core.toTailwind({ position: "sticky" }).indexOf("sticky") !== -1, "position:sticky -> sticky, got " + core.toTailwind({ position: "sticky" }).join(" "));
assert.deepStrictEqual(core.toTailwind({ position: "static" }), [], "position:static is a default and emits nothing");

// Fix 2: tallyValues must handle values that look like Object.prototype members.
// Previously: "toString", "constructor", etc. were silently dropped because
// counts was a bare {} inheriting from Object.prototype.
assert.deepStrictEqual(
  core.tallyValues(["toString", "toString", "a"]),
  [{ value: "toString", count: 2 }, { value: "a", count: 1 }],
  "tallyValues counts values shaped like Object.prototype members (toString)"
);

// Fix 3: tie-breaking must be tested with actual ties in frequency.
// Previously: the only test had counts 3/2/1 with no ties, so a sort bug would pass.
assert.deepStrictEqual(
  core.tallyValues(["z", "y", "x", "z", "y", "x"]),
  [{ value: "z", count: 2 }, { value: "y", count: 2 }, { value: "x", count: 2 }],
  "tallyValues breaks ties by first appearance (z, y, x)"
);

// ---- Task 2: study.js — the element readout ------------------------------

const studySrc = fs.readFileSync(MOD("study.js"), "utf8");
const study = require(MOD("study.js"));
assert.strictEqual(typeof study.create, "function", "study exports create");

// Study must be stack-agnostic — this is what separates it from measure.js and
// makes it sellable. Any framework-specific string here is a product bug.
assert.ok(!/_rsc=|Next-Action|__reactFiber|\/api\/attachments\/|supabase/i.test(studySrc),
  "study.js makes no framework assumptions");

// Read-only on the host page: Study must never mutate the site it inspects.
// Overlay chrome (createChrome) is exempt — it is created, not injected into
// existing nodes. Excise it by brace-matched index, not by an unanchored lazy
// regex: `[\s\S]*?function createChrome[\s\S]*?\n  }` looks like it strips just
// the function, but the leading `[\s\S]*?` is lazy and unanchored, so it eats
// everything from the START of the file through createChrome's first closing
// brace — silently exempting readStyles/diffDefaults/matchedRules/readElement
// (everything ABOVE createChrome) from this check too. Caught in review.
function exciseFunction(src, name) {
  const start = src.indexOf("function " + name);
  if (start === -1) return src;                     // nothing to excise
  const braceStart = src.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(0, start) + src.slice(i);
}
// Sanity floor — extractFunction (below, Task 6) has one; this didn't. Its
// dangerous failure direction is over-consumption (eating everything above
// createChrome too, the exact bug the comment above already describes), which
// silently widens the read-only exemption to functions that were never meant
// to be excused. readElement is defined well before createChrome in study.js,
// so it must still be present in the excised source.
assert.ok(/function readElement/.test(exciseFunction(studySrc, "createChrome")),
  "exciseFunction removed only createChrome, not the file before it");

assert.ok(!/\.setAttribute\(|\.innerHTML\s*=|\.remove\(\)/.test(
  exciseFunction(studySrc, "createChrome")),
  "study.js does not mutate the inspected page");

// Cross-origin stylesheets throw on .cssRules — that is normal and must be
// caught, or Study dies on most real sites at the first external font.
assert.ok(/try\s*{[\s\S]{0,400}cssRules/.test(studySrc), "stylesheet walk is guarded");

// Named dependency error, matching the pattern the other modules use.
assert.ok(/throw new Error\("annotate: study\.js requires/.test(studySrc), "named dep error");

for (const f of ["study.js"]) {
  const src = fs.readFileSync(MOD(f), "utf8");
  assert.ok(!/\.type\s*=\s*["']file["']/.test(src), "no file input in " + f);
}

// ---- Task 3: study.js — the whole-page sweep -----------------------------
// readPage() is the design system behind the whole page, not one element:
// palette/type-scale/weights/fonts by frequency, spacing on a detected grid,
// radii/shadows, and any custom properties the author declared as tokens.

assert.ok(/8000/.test(studySrc), "page sweep caps element count");
assert.ok(/truncated/.test(studySrc), "page sweep reports truncation — silent caps have cost this project before");
assert.ok(/detectScale/.test(studySrc), "page sweep runs grid detection");
assert.ok(/tallyValues/.test(studySrc), "page sweep frequency-ranks values");
// `/--/` alone is vacuous — it matches the "// ----" section banners that
// appear throughout this file (and most others in the repo), so it would stay
// green even with readCustomProps() deleted entirely. Assert the call instead.
assert.ok(/readCustomProps\(\)/.test(studySrc) && /customProps|customProperties/.test(studySrc), "page sweep collects CSS custom properties");

// The sweep must exclude the tool's OWN chrome (highlight box, inspector card,
// this very panel — all carry class __ann-ui) from the site's reported design
// system, or our accent colour/radii/shadows launder themselves in as the
// site's own. Checked with createChrome excised first, so this can't pass by
// picking up createChrome's own `panel.className = "__ann-ui"` assignment —
// it must find the exclusion check somewhere ELSE, i.e. on the sweep path.
// Asserted on the CALL, not a bare `/__ann-ui/` text search — the comment
// directly above the real guard (readPage's "all class `__ann-ui`") satisfies
// a bare substring search all by itself, so deleting the actual `el.closest(...)`
// guard line left this test green. A comment can't satisfy a call pattern.
assert.ok(/closest\(["']\.__ann-ui["']\)/.test(exciseFunction(studySrc, "createChrome")),
  "page sweep skips our own overlay chrome");

// isRootSelector: does this selector target :root's OWN custom properties —
// plain or themed? Lives in core.js (pure, no DOM) so it's testable for real,
// by calling it, not by grepping study.js for strings that also appear in
// comments (a grep like /data-theme/.test(studySrc) would pass even if this
// function were deleted entirely — it proves nothing).
assert.strictEqual(core.isRootSelector(":root"), true, ":root itself");
assert.strictEqual(core.isRootSelector("html"), true, "html itself");
assert.strictEqual(core.isRootSelector(':root[data-theme="dark"]'), true, "themed :root override");
assert.strictEqual(core.isRootSelector(":root, .dark"), true, "compound list — one branch qualifies");
assert.strictEqual(core.isRootSelector(".dark"), true, ".dark as a complete class is a theme root");
assert.strictEqual(core.isRootSelector(".darkroom"), false, ".darkroom is a component, not a theme root (the bug)");
assert.strictEqual(core.isRootSelector(".dark-blue-button"), false, ".dark-blue-button is a component, not a theme root (the bug)");
assert.strictEqual(core.isRootSelector("body"), false, "body is not :root");
assert.strictEqual(core.isRootSelector(".card"), false, "an ordinary component class");
assert.strictEqual(core.isRootSelector(""), false, "empty selector");

// study.js must consume the shared matcher, not keep its own copy — a second
// implementation is exactly how these two would drift apart again.
assert.ok(/isRootSelector\s*=\s*core\.isRootSelector/.test(studySrc), "study.js consumes core.isRootSelector, not a local reimplementation");

// ---- Tasks 4/5: study-motion.js — motion detection, all four tiers --------
// Plan amendment: this lives in its own module, not study.js — study.js was
// already past its line-count guideline and reading animations is a separate
// concern from reading styles. study.js's readMotion stub must now delegate.

const studyMotionSrc = fs.readFileSync(MOD("study-motion.js"), "utf8");
const studyMotion = require(MOD("study-motion.js"));
assert.strictEqual(typeof studyMotion.create, "function", "study-motion exports create");

// Tier 1 — getAnimations() is Baseline since 2020 and covers every CSS
// transition/animation completely, not approximately.
assert.ok(/getAnimations/.test(studyMotionSrc), "tier 1 uses the getAnimations standard");
assert.ok(/getKeyframes/.test(studyMotionSrc), "tier 1 reads real keyframes");
assert.ok(/getTiming/.test(studyMotionSrc), "tier 1 reads real timing");

// Tier 2 — GSAP is the jackpot; ScrollTrigger and Lottie were both confirmed
// against docs during design.
assert.ok(/globalTimeline/.test(studyMotionSrc) && /getChildren/.test(studyMotionSrc), "tier 2 enumerates GSAP tweens");
assert.ok(/ScrollTrigger/.test(studyMotionSrc), "tier 2 reads ScrollTrigger bindings");
assert.ok(/lottie|bodymovin/i.test(studyMotionSrc), "tier 2 detects Lottie");
// The GSAP per-tween accessors were unverified at design time — they must be
// probed, not assumed, or Study throws on a site that uses a different version.
assert.ok(/typeof\s+\w+\.targets/.test(studyMotionSrc), "GSAP tween accessors are probed defensively");
assert.ok(/tier/i.test(studyMotionSrc) && /confidence/.test(studyMotionSrc), "motion readout reports its own confidence");

// Tier 3 — detection without detail: a network fingerprint plus a live
// rAF/MutationObserver correlation, both of which must fully revert.
assert.ok(/getEntriesByType\(["']resource["']\)/.test(studyMotionSrc), "tier 3 fingerprints from network entries");
assert.ok(/MutationObserver/.test(studyMotionSrc), "tier 3 watches style mutations");
assert.ok(/requestAnimationFrame/.test(studyMotionSrc), "tier 3 samples the frame loop");
// Read-only is the whole promise of Study. A leaked rAF patch slows the page
// being studied and silently corrupts the thing it is measuring.
assert.ok(/origRaf|originalRaf/.test(studyMotionSrc), "tier 3 saves the original rAF");
assert.ok(/disconnect\(\)/.test(studyMotionSrc), "tier 3 disconnects its observer");

// Tier 4 — source maps are detected, not fetched/parsed. That is later work.
assert.ok(/sourceMappingURL/.test(studyMotionSrc), "tier 4 detects source maps");

// Named dependency error, matching the pattern every other module uses.
assert.ok(/throw new Error\("annotate: study-motion\.js requires/.test(studyMotionSrc), "named dep error");

// Read-only on the host page: nothing here may write to an existing page node.
// study-motion.js has no chrome to excise (unlike study.js's createChrome) —
// it only reads globals/DOM and patches window.requestAnimationFrame, which is
// a global function reference, not a page node.
assert.ok(!/\.setAttribute\(|\.innerHTML\s*=|\.remove\(\)/.test(studyMotionSrc),
  "study-motion.js does not mutate the inspected page");

assert.ok(!/\.type\s*=\s*["']file["']/.test(studyMotionSrc), "no file input in study-motion.js");

// study.js's readMotion must now delegate rather than return the stub, and
// nothing else in study.js may have changed to make that happen.
assert.ok(!/notImplemented/.test(studySrc), "study.js no longer returns the stub");
assert.ok(/studyMotion/.test(studySrc), "study.js's readMotion delegates to study-motion.js");

// ---- Task 6: Study becomes the fourth mode -------------------------------

// index.js must know the study mode and expose both agent-facing entry points.
assert.ok(/"study"/.test(indexSrc), "index.js knows the study mode");
for (const api of ["__annotatorStudyTake", "__annotatorStudyPage"]) {
  assert.ok(indexSrc.indexOf("window." + api) !== -1, "index.js exposes " + api);
}

// THE guard that matters most with a fourth mode: rewritten as === "off", point mode
// would start swallowing clicks during Study. Re-checked here (not just at Task 5's
// spot above) because this is the exact regression Task 6 is most likely to cause.
const pointGuardsWithStudy = pointSrc.match(/mode\s*!==\s*["']on["']/g) || [];
assert.ok(pointGuardsWithStudy.length >= 4, "point.js still guards on !== 'on' with four modes, found " + pointGuardsWithStudy.length);
assert.ok(!/mode\s*===\s*["']off["']/.test(pointSrc), "no === 'off' guards, even with a fourth mode");

// Study must not swallow navigation the way point mode does: only `click` is
// intercepted, never pointerdown/mousedown/auxclick.
assert.ok(/addEventListener\(["']click["']/.test(studySrc), "study.js intercepts click");
assert.ok(!/addEventListener\(["'](?:pointerdown|mousedown|auxclick)["']/.test(studySrc), "study.js does not intercept pointerdown/mousedown/auxclick — studying a site means navigating it");

// THE regression the live browser gate actually caught: onClick guarding on !shiftKey
// still called preventDefault()/stopPropagation() unconditionally, silently eating every
// link click in Study mode (contradicting its own comment). Extract onClick's own body
// (not just "absent anywhere in the file") so a stray preventDefault elsewhere can't hide
// a real regression here, or a real fix here be masked by one lingering somewhere else.
function extractFunction(src, name) {
  var start = src.indexOf("function " + name);
  if (start === -1) return "";
  var braceStart = src.indexOf("{", start);
  var depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
var studyOnClick = extractFunction(studySrc, "onClick");
assert.ok(studyOnClick.length > 0, "found study.js's onClick to inspect");
assert.ok(!/preventDefault|stopPropagation/.test(studyOnClick), "study.js's onClick must never block or swallow the click — a plain link click must still navigate");

// study.js's readMotion wrapper must forward onUpdate to study-motion.js's real
// readMotion, not drop it — a dropped onUpdate makes take()'s early-resolve path
// (below) never fire, so every call would silently burn its full ceiling instead
// of resolving as soon as the real tiers finish (caught live: it "worked" only by
// accident, via readMotion's returned object being mutated in place regardless).
assert.ok(/function\s+readMotion\s*\(\s*el\s*,\s*onUpdate\s*\)/.test(studySrc), "study.js's readMotion wrapper accepts onUpdate");
assert.ok(/studyMotion\.create\(\{\}\)\.readMotion\(el,\s*onUpdate\)/.test(studySrc), "study.js's readMotion wrapper forwards onUpdate to study-motion.js");

// study.js exposes take() — the Promise wrapper around readMotion's async tiers.
// Without it, __annotatorStudyTake() would hand the agent a permanent
// {status:"sampling"}/{status:"checking"} for exactly the bundled-library case
// tier 3 exists to catch.
assert.ok(/take\s*:\s*take/.test(studySrc), "study.js's create() exposes take()");
assert.ok(/new Promise/.test(studySrc), "take() wraps readMotion in a Promise");
assert.ok(/setTimeout/.test(studySrc.slice(studySrc.indexOf("function take"))), "take() has a ceiling so it cannot hang the agent's browser_evaluate call");

// Obligation (b): study-motion.js's rAF patch must use .apply(this, arguments), matching
// measure.js's identical pattern — safe today only because eval/require are always sloppy.
assert.ok(/origRaf\.apply\(this,\s*arguments\)/.test(studyMotionSrc), "study-motion.js's rAF patch uses .apply(this, arguments), not a bare call");

// ---- Post-approval finding: exclude the overlay's OWN modules from the motion
// fingerprint ---------------------------------------------------------------
// The loader fetches every module (including study-motion.js itself) INSIDE the
// inspected page's JS context, so Resource Timing records them as real entries —
// on every site, every session. FINGERPRINT_RE's bare "motion" alternative
// matches "study-motion.js", so without this filter Study reports a spurious
// "motion library detected" unconditionally. This is a real function called with
// real cases, not a source-text grep — a grep can't prove the origin/basename
// logic is right.
assert.strictEqual(typeof core.isOwnModuleUrl, "function", "core exports isOwnModuleUrl");

assert.strictEqual(
  core.isOwnModuleUrl("http://127.0.0.1:7788/study-motion.js", "http://127.0.0.1:7788/"),
  true, "own module served from the boot base is excluded"
);
assert.strictEqual(
  core.isOwnModuleUrl("https://x.com/a/motion.abc.js", "http://127.0.0.1:7788/"),
  false, "the SITE'S OWN motion bundle, a different origin, is never excluded"
);
assert.strictEqual(
  core.isOwnModuleUrl("https://x.com/js/index.js", "http://127.0.0.1:7788/"),
  false, "a site file with a colliding basename (index.js) on a DIFFERENT origin is never excluded — basename alone must not disqualify a real site resource"
);
assert.strictEqual(
  core.isOwnModuleUrl("https://cdn.x/gsap.min.js", "http://127.0.0.1:7788/"),
  false, "gsap from a real CDN is never excluded"
);
assert.strictEqual(
  core.isOwnModuleUrl("https://any.site/whatever.js", null),
  false, "no boot base -> exclude nothing (an unknown boot origin must never start excluding real site resources)"
);
assert.strictEqual(
  core.isOwnModuleUrl("http://127.0.0.1:7788/js/index.js", "http://127.0.0.1:7788/"),
  true, "same-origin basename match (index.js under the boot origin, not an exact base-prefix path) is excluded via the secondary guard"
);

// fingerprintFromNetwork must actually call the filter, not just have it lying
// around unused in core.js.
assert.ok(/core\.isOwnModuleUrl/.test(studyMotionSrc), "study-motion.js's fingerprint scan calls core.isOwnModuleUrl");

// ---- Whole-branch review fix wave -----------------------------------------

// IMPORTANT 1: FINGERPRINT_RE's bare "motion" substring matched
// /assets/promotions.js, promotion-banner.css, and emotion.js (the CSS-in-JS
// library, unrelated to motion) — "promotions" is near-universal on
// ecommerce/marketing sites, exactly Study's target population. The real
// matcher is core.isMotionFingerprintUrl: basename-only, word-bounded. A real
// function called with real cases, not a source-text grep.
assert.strictEqual(typeof core.isMotionFingerprintUrl, "function", "core exports isMotionFingerprintUrl");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/assets/promotions.js"), false, "promotions.js is not a motion library (the bug)");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/emotion.js"), false, "emotion.js (CSS-in-JS) is not a motion library (the bug)");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/promotion-banner.css"), false, "promotion-banner.css is not a motion library (the bug)");
assert.strictEqual(core.isMotionFingerprintUrl("https://cdn.x/gsap.min.js"), true, "gsap.min.js is a motion library");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/a/motion.abc123.js"), true, "motion.abc123.js is a motion library");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/js/framer-motion.chunk.js"), true, "framer-motion.chunk.js is a motion library");
assert.strictEqual(core.isMotionFingerprintUrl("https://x.com/three.module.js"), true, "three.module.js is a motion library");
assert.strictEqual(core.isMotionFingerprintUrl(""), false, "empty url -> false, never throws");
assert.strictEqual(core.isMotionFingerprintUrl(null), false, "null url -> false, never throws");

// study-motion.js must actually call the real matcher, not keep the old bare
// regex around (which would make the function above dead code the fingerprint
// scan never uses).
assert.ok(!/FINGERPRINT_RE/.test(studyMotionSrc), "the old unbounded FINGERPRINT_RE is gone from study-motion.js");
assert.ok(/core\.isMotionFingerprintUrl/.test(studyMotionSrc), "study-motion.js's fingerprint scan calls core.isMotionFingerprintUrl");

// IMPORTANT 2: the self-match bug returns whenever localStorage is unavailable.
// Both the write (overlay.js's boot()) and the read (study-motion.js) swallow
// their exceptions, and the read had no fallback — a sandboxed iframe or a
// storage-blocked context left bootBase null, isOwnModuleUrl excluded nothing,
// and Study reported its own study-motion.js as a detected motion library on
// every such page.
assert.ok(/window\.__annBootBase\s*=\s*base/.test(loaderSrc), "overlay.js's boot() also stashes the boot base in memory, next to the localStorage write");
assert.ok(/window\.__annBootBase/.test(studyMotionSrc), "study-motion.js's fingerprint scan prefers the in-memory boot base over localStorage");

// Minor 5: a cancelled tier-3 sample (superseded by a second concurrent
// take()) must never be summarized as "no motion detected" — that is a
// confident false negative, the one failure mode this feature must never
// produce.
assert.ok(/tier3\.proof\s*&&\s*r\.tier3\.proof\.cancelled/.test(studyMotionSrc), "summarizeConfidence checks for a cancelled tier-3 sample");
assert.ok(/tier3: sample cancelled/.test(studyMotionSrc), "a cancelled sample is reported as cancelled, not folded into 'no motion detected'");

// Minor 6: the tier-3 MutationObserver watched the element only — a card
// whose CHILD is the animated node (a common structure: inner wrapper gets
// the transform/opacity write) read jsDriven: false, a silent false negative
// reported as fact.
assert.ok(/observe\(el,\s*\{\s*attributes:\s*true,\s*attributeFilter:\s*\["style"\],\s*subtree:\s*true\s*\}\)/.test(studyMotionSrc),
  "tier 3's observer watches the element's subtree too, not just the element itself");

// Minor 7 is checked earlier, alongside the loader/core file-list sync check.

// Minor 8: lastEl must be reset on BOTH pin and unpin, or the panel/highlight
// can show a stale element until the cursor reaches a THIRD one after an
// pin -> unpin sequence.
var studyOnClickFixed = extractFunction(studySrc, "onClick");
assert.ok(studyOnClickFixed.length > 0, "found study.js's onClick to inspect");
var lastElResets = studyOnClickFixed.match(/lastEl\s*=\s*null/g) || [];
assert.ok(lastElResets.length >= 2, "study.js's onClick resets lastEl on both the pin and the unpin branch, found " + lastElResets.length);

// Minor 10: exciseFunction (used above) needed the same sanity floor
// extractFunction already has — checked earlier, right after its definition.

// Minor 11: tier4.candidateScripts included CSS/font/image URLs that tier 4's
// JS-only sourceMappingURL regex can never match — a wasted fetch on every
// one, and a misleading field name. Filtered to .js before tier4 uses them.
assert.ok(/function filterJsUrls/.test(studyMotionSrc), "study-motion.js filters candidate scripts to .js");
assert.ok(/candidateScripts:\s*jsCandidates/.test(studyMotionSrc), "tier4.candidateScripts is the filtered .js list, not the raw fingerprint");
assert.ok(/probeSourceMaps\(jsCandidates,/.test(studyMotionSrc), "tier 4's source-map probe fetches only the filtered .js candidates");

// Minor 12: the shortcut guide's "Click" row was hardcoded to point-mode's
// "Leave a comment" even while the pill read Study (where a click pins a
// readout) or Measure (where clicks pass straight through). ui.js must not
// branch on mode itself (existing invariant, asserted above) — the fix drives
// the text from index.js, which already owns the pill label.
assert.ok(/setClickHint/.test(uiSrc), "ui.js exposes a setter for the guide's Click-row text");
assert.ok(!/mode\s*[!=]==?\s*["'](?:on|study|measure|off)["']/.test(uiSrc), "ui.js still does not branch on mode (Minor 12 must not violate this)");
assert.ok(/setClickHint/.test(indexSrc), "index.js drives the Click-row text, keeping mode logic out of ui.js");

// ---- Phase 1b: the reconcile classifier ----------------------------------

// nearestInScale — the token a studied value is closest to.
assert.deepStrictEqual(core.nearestInScale(20, [6, 10, 16, 999]), { value: 16, distance: 4 },
  "nearest to 20 in 6/10/16/999 is 16");
assert.deepStrictEqual(core.nearestInScale(16, [6, 10, 16]), { value: 16, distance: 0 },
  "an exact member has distance 0");
assert.strictEqual(core.nearestInScale(12, []), null, "empty scale has no nearest");

// classifyValue — the three verdicts.
assert.strictEqual(core.classifyValue(16, [6, 10, 16, 999]).verdict, "fits",
  "an exact match fits");
assert.strictEqual(core.classifyValue(20, [6, 10, 16, 999]).verdict, "conflict",
  "20 against 16 is a CONFLICT — two radii 4px apart doing the same job is how scales rot");
assert.strictEqual(core.classifyValue(400, [6, 10, 16]).verdict, "new",
  "far from everything is a new token, not a conflict");
assert.strictEqual(core.classifyValue(12, []).verdict, "new",
  "nothing to conflict with in an empty scale");
assert.strictEqual(core.classifyValue(12, [8]).verdict, "new",
  "a scale of one is not yet a scale");

// The asymmetry, asserted directly. Being wrong toward "conflict" costs one
// decision; being wrong toward "new" silently corrupts the user's scale.
assert.strictEqual(core.classifyValue(17, [16]).verdict, "new",
  "single-entry scale still yields new, not conflict");
assert.strictEqual(core.classifyValue(17, [16, 24, 32]).verdict, "conflict",
  "17 against an established scale containing 16 is a conflict");

// A conflict must carry a usable suggestion — the 'adapt' option needs a target.
var c = core.classifyValue(20, [6, 10, 16, 999]);
assert.strictEqual(c.nearest.value, 16, "conflict names the token it collides with");
assert.strictEqual(typeof c.suggestion, "string", "conflict carries a suggestion string");

// reconcile — a whole study against a whole language.
// (named reconcileStudy/reconcileLang — study.js's own module is already
// bound to `study` above, from Task 2's require)
var reconcileStudy = { radii: [20], spacing: [16, 24], shadows: ["0 8px 30px rgba(0,0,0,.12)"] };
var reconcileLang  = { radii: [6, 10, 16, 999], spacing: [4, 8, 16, 24, 32], shadows: [] };
var r = core.reconcile(reconcileStudy, reconcileLang);
assert.ok(r.conflicts.length >= 1, "the 20px radius conflicts");
assert.ok(r.fits.length >= 2, "16 and 24 spacing already fit");
assert.ok(r.adopt.length >= 1, "the shadow is new — the language has none");
// Every studied value must appear in exactly one bucket. A value that falls
// through all three is a silent loss of the user's decision.
var total = r.fits.length + r.adopt.length + r.conflicts.length;
assert.strictEqual(total, 4, "every studied value lands in exactly one bucket, got " + total);

// ---- Fix wave: zero-token ratio + non-array reconcile values -------------
// Caught in review: nearestInScale's first-seen tie-break made the SAME value
// against the SAME scale (just reordered) classify differently, and
// classifyValue's distance/base ratio went to Infinity whenever the nearest
// token was 0 — always "new", the unsafe direction the whole asymmetry rule
// exists to avoid.

assert.deepStrictEqual(core.nearestInScale(2, [0, 4]), core.nearestInScale(2, [4, 0]),
  "nearest is order-independent (ties break on the smaller token, not array position)");

assert.strictEqual(
  core.classifyValue(2, [0, 4, 8, 16, 24]).verdict,
  core.classifyValue(2, [4, 8, 16, 24, 0]).verdict,
  "classifyValue verdict is order-independent even when the nearest token is 0"
);

assert.strictEqual(core.classifyValue(0.01, [0, 10]).verdict, "conflict",
  "a value essentially AT 0 must not read as 'new' just because dividing by a 0 token blows up the ratio");

// reconcile: a scalar (non-array) study value must not silently vanish.
var scalarResult = core.reconcile({ opacity: 0.5 }, {});
var scalarTotal = scalarResult.fits.length + scalarResult.adopt.length + scalarResult.conflicts.length;
assert.strictEqual(scalarTotal, 1, "a scalar study value lands in exactly one bucket, not dropped");

// reconcile: a bare string must be treated as ONE token, not shredded into one
// entry per character (a string has .length too, which is what caused this).
var stringResult = core.reconcile({ shadowLabel: "abc" }, {});
var stringTotal = stringResult.fits.length + stringResult.adopt.length + stringResult.conflicts.length;
assert.strictEqual(stringTotal, 1, "a bare string study value is ONE token, not one entry per character");

// ---- Task 2: Favouriting in Study mode ------------------------------------

// study.create() itself touches no DOM (only enable() does, via createChrome),
// so this is a real behavioral check, not a source-text grep: call it for
// real and inspect the returned handles.
var studyCtx = { pal: {}, ui: { isOurs: function () { return false; } } };
var studyHandles = study.create(studyCtx);
assert.strictEqual(typeof studyHandles.favourite, "function", "study.create() exposes favourite()");
assert.strictEqual(typeof studyHandles.takeFavourite, "function", "study.create() exposes takeFavourite()");

// Nothing is pinned in a fresh create() (enable() was never called) — calling
// favourite() must not throw, and must not fabricate a record with nothing to
// attach it to.
assert.strictEqual(studyHandles.favourite("a note", ["x"]), null, "favourite() is a no-op (returns null) when nothing is pinned");

// takeFavourite() must return a real Promise — never undefined, never a
// synchronous value — and it must resolve to null (not reject) when nothing
// is pinned. This exercises the exact early-return path take() already uses,
// with no DOM access required.
var favPromise = studyHandles.takeFavourite();
assert.ok(favPromise instanceof Promise, "takeFavourite() returns a Promise");

// favourite(note, tags) must take exactly two parameters — no third `url`
// parameter a caller could use to override capture-time location.href.
assert.ok(/function favourite\s*\(\s*note,\s*tags\s*\)/.test(studySrc),
  "favourite(note, tags) takes exactly two params — no url parameter");

// Both favourite() and takeFavourite() must source url from location.href
// directly, inside the module — never accept it as an argument.
var favouriteBody = extractFunction(studySrc, "favourite");
var takeFavouriteBody = extractFunction(studySrc, "takeFavourite");
assert.ok(favouriteBody.length > 0, "found study.js's favourite() to inspect");
assert.ok(takeFavouriteBody.length > 0, "found study.js's takeFavourite() to inspect");
// Split into two independent assertions (not one OR) — an OR is satisfied by
// either side alone, so it would stay green if a future change dropped
// location.href from JUST takeFavourite()'s fallback, which is the path taken
// every time a user pins an element and calls takeFavourite() without first
// clicking Save favourite. That path losing url silently is exactly the
// failure this field's "never optional" requirement exists to prevent.
assert.ok(/location\.href/.test(favouriteBody),
  "favourite() captures url from location.href inside the module, not passed in");
assert.ok(/location\.href/.test(takeFavouriteBody),
  "takeFavourite()'s no-favourite-yet fallback captures url from location.href inside the module, not passed in");

// takeFavourite() must REUSE take()'s existing Promise/ceiling machinery, not
// re-implement it — a fresh `new Promise`/`setTimeout` here would mean the
// motion sample is redone from scratch, ungated by take()'s 3s ceiling.
assert.ok(/\btake\(\)/.test(takeFavouriteBody), "takeFavourite() calls take(), reusing its existing path");
assert.ok(!/new Promise/.test(takeFavouriteBody), "takeFavourite() does not re-implement take()'s Promise wrapping");
assert.ok(!/setTimeout/.test(takeFavouriteBody), "takeFavourite() does not re-implement take()'s ceiling timer");

// study.js's create() must return both as real handles (source-text, mirroring
// the existing take() check above it).
assert.ok(/favourite:\s*favourite/.test(studySrc), "study.js's create() exposes favourite in its return object");
assert.ok(/takeFavourite:\s*takeFavourite/.test(studySrc), "study.js's create() exposes takeFavourite in its return object");

// index.js must expose the agent-facing entry point, wired to takeFavourite()
// (not to favourite(), and not a bare re-export with the wrong arity).
assert.ok(indexSrc.indexOf("window.__annotatorStudyFavourite") !== -1, "index.js exposes __annotatorStudyFavourite");
assert.ok(/window\.__annotatorStudyFavourite\s*=\s*function\s*\(\s*\)\s*{\s*return\s+studyMode\.takeFavourite\(\)\s*;?\s*}/.test(indexSrc),
  "__annotatorStudyFavourite forwards to studyMode.takeFavourite()");

// ui.js gains a generic note/tag input — exposed as handles, not as a
// mode-aware branch. The existing "no mode branching" assertions above
// already re-run against this same uiSrc, so a violation here fails them too;
// these two additionally prove the new handles are real, not just absent
// mode-checks.
assert.ok(/setFavouriteVisible\s*:/.test(uiSrc), "ui.js exposes setFavouriteVisible, mirroring setClickHint's show/hide-from-outside pattern");
assert.ok(/onFavouriteSave\s*:/.test(uiSrc), "ui.js exposes onFavouriteSave so index.js can wire the note/tag submit without ui.js knowing about study mode");

// index.js is the one that decides visibility and wires the callback through
// to studyMode.favourite() — ui.js must never call studyMode itself.
assert.ok(/setFavouriteVisible/.test(indexSrc), "index.js drives favourite-panel visibility, keeping mode logic out of ui.js");
assert.ok(/onFavouriteSave/.test(indexSrc), "index.js registers the favourite-save handler");
assert.ok(/studyMode\.favourite\(/.test(indexSrc), "index.js's favourite-save handler calls studyMode.favourite()");
assert.ok(!/studyMode\.favourite/.test(uiSrc), "ui.js never calls studyMode directly");

// ---- Task 4: unit-bearing values reach the classifier as CSS literals ------

// The study readout produces "20px", not 20 — that is the shape the promote
// procedure in SKILL.md actually feeds in. Number("20px") is NaN, so before
// this these fell to the string-equality branch and came back "new": the
// UNSAFE verdict, silently adding a second radius doing 16px's job.
assert.strictEqual(core.classifyValue("20px", [6, 10, 16, 999]).verdict, "conflict",
  "'20px' against a scale containing 16 is a conflict — a unit must not turn it into 'new'");
assert.strictEqual(core.classifyValue("16px", [6, 10, 16]).verdict, "fits",
  "'16px' matches the token 16 exactly");
// The unit may be on the SCALE side instead. This scale is deliberately narrow
// (16/18): a bare Number() on the nearest token yields NaN, which falls through
// to the scale-RANGE fallback, and a range of 2 makes 25 look far away — "new".
// A wider scale would be classified correctly by the fallback anyway and so
// would prove nothing about the line under test.
assert.strictEqual(core.classifyValue(25, ["16px", "18px"]).verdict, "conflict",
  "a px-suffixed SCALE is read numerically — not left as NaN for the range fallback to paper over");
assert.strictEqual(core.classifyValue("1.5rem", ["1rem", "1.25rem", "2rem"]).verdict, "conflict",
  "rem scales compare on their own terms, no px assumption");

// The zero-token fallback measures against the scale's own SPREAD, so it too
// has to read units. A "0px" nearest token forces that path; without a unit-aware
// read the spread computes as 0 and the ratio goes Infinite — "new", the unsafe
// direction, for a value sitting 1px from a token the user already has.
assert.strictEqual(core.classifyValue(1, ["0px", "8px"]).verdict, "conflict",
  "the zero-token spread fallback reads a px-suffixed scale numerically too");

// Only a PURE dimension is unwrapped. A shadow starts with "0", and parsing it
// numerically would collapse every shadow to 0 and start reporting distances
// between values that have none.
assert.strictEqual(core.classifyValue("0 8px 30px rgba(0,0,0,.12)", ["0 1px 2px black", "0 2px 4px black"]).verdict, "new",
  "a shadow string stays one opaque value — never parsed down to its leading 0");
assert.strictEqual(core.classifyValue("0 1px 2px black", ["0 1px 2px black", "0 2px 4px black"]).verdict, "fits",
  "an identical shadow string still fits by exact equality");

// Mismatched units are not comparable without a root font size we don't have.
// Inventing one would manufacture a conflict out of a unit difference.
// 20 and 16 are only 4 apart, so dropping the unit guard would call this a
// conflict between 20rem (320px) and 16px — a collision that does not exist.
// The numbers are chosen to be CLOSE on purpose: a far-apart pair reads "new"
// with or without the guard and would prove nothing.
assert.strictEqual(core.classifyValue("20rem", ["16px", "24px", "32px"]).verdict, "new",
  "rem against a px scale is not comparable — 'new', never a conflict fabricated out of a unit mismatch");

// ---- Task 5: absent values are not design decisions ------------------------

// Found in the real browser run, not by reading: getComputedStyle answers every
// property whether the author set it or not, so a studied card came back with
// boxShadow "none" and paddingTop "0px" and the promote step duly offered to
// adopt `shadow: none` into the user's design language. Filtering happens at
// the caller, so the helper has to be right about both directions.
["none", "normal", "auto", "0", "0px", "0%", "0s", "transparent", "rgba(0, 0, 0, 0)", "", null, undefined]
  .forEach(function (v) {
    assert.strictEqual(core.isAbsentValue(v), true, JSON.stringify(v) + " is the absence of a decision, not one");
  });

// Real values must survive — a filter that eats them loses the user's decision,
// which is the failure this whole phase is built to prevent. "0 1px 2px black"
// starts with a zero and must NOT be mistaken for the absent "0".
["12px", "0 1px 2px black", "1.5rem", "600", "#fff", "rgb(0, 0, 0)", "cubic-bezier(.2,.8,.2,1)"]
  .forEach(function (v) {
    assert.strictEqual(core.isAbsentValue(v), false, JSON.stringify(v) + " is a real value and must survive the filter");
  });

// ---- Task 3: the seed design-language template ----------------------------

// The template is shipped into OTHER people's projects. Portability is a
// product constraint: anything specific to the project this tool grew up in
// (Tideswell) leaking into the seed would hand a stranger our tokens as if
// they were their own decisions.
const templateSrc = fs.readFileSync(path.join(__dirname, "templates", "design-language.md"), "utf8");

[/--surface-/, /--coral/, /glass-edge/, /Tailwaters/i, /Tideswell/i].forEach(function (pattern) {
  assert.ok(!pattern.test(templateSrc), "seed template is stack-neutral: contains no " + pattern.source);
});

// The no-Tideswell-tokens check above is satisfied by an EMPTY file, so it
// only means something alongside proof the template is actually the document
// it claims to be. Both halves have to hold.
["Principles", "Colour", "Spacing & grid", "Typography", "Radii", "Shadows", "Motion", "Components"].forEach(function (section) {
  assert.ok(templateSrc.indexOf("## " + section) !== -1, "seed template has a '" + section + "' section");
});

// Every section carries the explicit not-yet-decided marker — a blank section
// and a section nobody has got to yet are indistinguishable without it, and
// the whole point of the seed is that an unfilled slot reads as unfilled.
assert.ok((templateSrc.match(/\*\*Not yet decided\.\*\*/g) || []).length >= 8,
  "seed template marks every section 'Not yet decided'");

// The template is only reachable through SKILL.md — an unreferenced file in a
// skill directory is a file an executing agent never finds.
const skillSrc = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
assert.ok(skillSrc.indexOf("templates/design-language.md") !== -1,
  "SKILL.md points at the seed template by path");
assert.ok(/__annotatorStudyFavourite/.test(skillSrc),
  "SKILL.md documents the favourite entry point");

Promise.all([
  favPromise.then(function (v) {
    assert.strictEqual(v, null, "takeFavourite() resolves null (not undefined, not rejected) when nothing is pinned");
  })
]).then(function () {
  console.log("overlay.test: ok");
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
