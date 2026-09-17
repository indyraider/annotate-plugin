// Self-check for the one piece of tricky logic in overlay.js: buildSelector.
// Pure helpers now live in overlay/core.js and are required directly; overlay.js
// itself is now just the loader (Task 6) — its source is still read (never
// executed here) for the file-input regression guard and the loader's own checks.
// Run: node skills/annotate/overlay.test.cjs
const fs = require("node:fs");
const assert = require("node:assert");


// Modules are loaded individually so a break is attributed to one file.
const path = require("node:path");
const MOD = function (name) { return path.join(__dirname, "overlay", name); };

// Source with the full-line comments stripped out.
//
// Every "this file must NOT do X" assertion needs it. These modules explain
// their own bans in comments — why queryLocalFonts is avoided, why the datalist
// was dropped, why the colour ramp went — so a grep over raw source matches the
// EXPLANATION as readily as the thing it forbids, and the assertion fails on the
// prose defending the very rule it enforces. That happened three times before
// this existed; each time the fix was to write the same filter again inline.
const codeOf = function (s) {
  return s.split("\n").filter(function (l) { return l.trim().indexOf("//") !== 0; }).join("\n");
};
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

// The palette is FIXED and dark. It used to derive itself from the host page's
// computed background and text so the toolbar looked native wherever it landed;
// Matt's call 2026-08-20 was to hardcode it, because a chrome that changes
// colour depending on the site is a chrome you re-read every time. These
// assertions are the old ones inverted, deliberately — the derivation is not a
// thing to restore by accident.
const paletteCode = codeOf(paletteSrc);
assert.ok(!/getComputedStyle/.test(paletteCode), "the palette is hardcoded, not derived from the host page");
assert.ok(!/color-mix/.test(paletteCode), "the derived colour ramp is gone with it");
assert.ok(/ACCENT/.test(paletteSrc), "palette keeps a fixed accent identity — it is what makes a highlight read as ours");


// ui.js owns chrome only — no mode logic, no annotation records.
assert.ok(!/__annotations\b/.test(uiSrc), "ui.js does not touch annotation state");
assert.ok(!/mode\s*[!=]==?\s*["']on["']/.test(uiSrc), "ui.js does not branch on mode");

// The file-chooser ban and the mode-guard rule are overlay-wide invariants.
// They are re-asserted per module so a future split cannot quietly drop them.
for (const f of ["core.js", "palette.js", "fontpicker.js", "fontspanel.js", "ui.js"]) {
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

// Dark means dark: the two surfaces consumers paint panels with must actually be
// dark, or the light text above them is unreadable. Parsed, not eyeballed.
const paletteBuilt = palette.build();
[["elevated", paletteBuilt.elevated], ["surface", paletteBuilt.surface]].forEach(function (pair) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(pair[1]);
  assert.ok(m, "palette." + pair[0] + " is an opaque hex colour, got " + pair[1]);
  const lum = (parseInt(m[1], 16) * 0.2126 + parseInt(m[2], 16) * 0.7152 + parseInt(m[3], 16) * 0.0722) / 255;
  assert.ok(lum < 0.25, "palette." + pair[0] + " is dark (luminance " + lum.toFixed(3) + ")");
});
const textLum = (function (hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return (parseInt(m[1], 16) * 0.2126 + parseInt(m[2], 16) * 0.7152 + parseInt(m[3], 16) * 0.0722) / 255;
})(paletteBuilt.text);
assert.ok(textLum > 0.75, "the body text colour is light enough to sit on those surfaces");

// Contrast, computed rather than eyeballed. Hardcoding the theme means nobody is
// checking these against a real page any more, and text3 carries the SMALLEST
// text in the tool — the 10-11px control labels and element counts. Its first
// hand-picked value measured 3.08:1 on a card, which is a legibility bug that
// looks fine to whoever picked it on a good monitor.
function srgbLum(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  assert.ok(m, "expected an opaque hex colour, got " + hex);
  const chan = function (h) {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(m[1]) + 0.7152 * chan(m[2]) + 0.0722 * chan(m[3]);
}
function contrast(a, b) {
  const la = srgbLum(a), lb = srgbLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
["text", "text2", "text3"].forEach(function (ink) {
  ["elevated", "surface", "surface2"].forEach(function (ground) {
    const r = contrast(paletteBuilt[ink], paletteBuilt[ground]);
    assert.ok(r >= 4.5, "palette." + ink + " on palette." + ground + " is " + r.toFixed(2) + ":1, below the 4.5:1 floor");
  });
});
// And they have to stay distinguishable from each other, or the hierarchy the
// three tones exist to express collapses into one grey.
assert.ok(contrast(paletteBuilt.text, paletteBuilt.text3) > 1.5, "the ink tones are actually different from one another");

// build() must hand back a COPY. Twenty call sites read `pal.x`; one that wrote
// to it would restyle the whole overlay from somewhere unrelated.
//
// The expected value is captured as a STRING first, on purpose. Comparing
// against `paletteBuilt.text` looks equivalent and is not: if build() handed out
// the shared object, the write below would change that property too, both sides
// would move together, and the assertion would pass while proving nothing.
const textBefore = String(palette.build().text);
palette.build().text = "#ff0000";
assert.strictEqual(palette.build().text, textBefore, "build() returns a copy, so a consumer cannot mutate the palette");

// One typeface for the whole overlay. The monospace face is gone; the column
// alignment it bought comes from tabular figures instead, set once in ui.js.
assert.strictEqual(palette.MONO, undefined, "there is no monospace face any more");
assert.ok(/Geist/.test(palette.SANS), "the UI face is Geist");
assert.ok(/system-ui|sans-serif/.test(palette.SANS), "with a real fallback stack — Geist is not installed, it is fetched, and a CSP can refuse it");
assert.ok(/tabular-nums/.test(uiSrc), "figures stay tabular, which is what pays for dropping the monospace");
assert.ok(/FONT_CSS_URL/.test(uiSrc), "ui.js actually loads the face — a stack naming a font nobody has is a no-op");
["MONO"].forEach(function (gone) {
  ["ui.js", "fontpicker.js", "fontspanel.js", "study.js"].forEach(function (f) {
    assert.ok(!new RegExp("\\b" + gone + "\\b").test(codeOf(fs.readFileSync(MOD(f), "utf8"))), gone + " is gone from " + f);
  });
});


const ui = require(MOD("ui.js"));
assert.strictEqual(typeof ui.create, "function", "ui exports create");

// Task 5 consumes these key names literally; a silent rename here would break it with
// no test failing. Guard on the source text of each module's returned object.
const paletteKeys = ["elevated", "surface", "surface2", "hover", "border", "hairline", "text", "text2", "text3", "accent", "accentFg", "accentSoft"];
for (const k of paletteKeys) {
  assert.ok(new RegExp(k + "\\s*:").test(paletteSrc), "palette.build() return must include key " + k);
}
const uiKeys = ["showHighlight", "hideHighlight", "showInspector", "hideInspector", "bar", "toolbar", "guide", "help", "setModes", "setActiveMode", "setModeTools", "isOurs", "fontsPanel", "setFontOptions", "setFontSlots", "onFontSlotChange"];
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
for (const f of ["point.js", "measure.js", "fonts.js", "index.js"]) {
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
for (const api of ["__annotatorDrain", "__annotatorWait", "__annotatorPerfTake", "__annotatorReveal", "__annotatorImageTake", "__annotatorFontsTake"]) {
  assert.ok(indexSrc.indexOf("window." + api) !== -1, "index.js still exposes " + api);
}

// The long-poll is woken directly by save(); a poll-interval-bound version
// would make every comment feel laggy.
assert.ok(/waiter/.test(indexSrc), "index.js keeps the one-shot waiter");
assert.ok(/25000/.test(indexSrc), "index.js keeps the 25s long-poll ceiling");

// The idempotent re-inject guard.
assert.ok(/if\s*\(\s*window\.__annotator\s*\)\s*return/.test(indexSrc), "index.js keeps the re-inject guard");

// The mode cycle must remain off -> on -> measure -> study -> off. This used to
// be a grep for a ternary cascade, which said nothing about what the cascade
// DID and went stale the moment the toolbar replaced it. It is now behavioural:
// core.nextMode is pure, so the actual rotation can be walked.
var CYCLE_KEYS = ["on", "measure", "study"];
assert.strictEqual(core.nextMode("off", CYCLE_KEYS), "on", "off -> on");
assert.strictEqual(core.nextMode("on", CYCLE_KEYS), "measure", "on -> measure");
assert.strictEqual(core.nextMode("measure", CYCLE_KEYS), "study", "measure -> study, never straight back to off");
assert.strictEqual(core.nextMode("study", CYCLE_KEYS), "off", "study -> off closes the loop");

// A mode that ships disabled is absent from the keys, so it can never be landed
// on — Compare is greyed out in the toolbar and must not be a dead stop where
// Alt+A appears to do nothing.
assert.strictEqual(CYCLE_KEYS.indexOf("compare"), -1, "a disabled mode contributes no cycle key");

// An unrecognised mode has to resolve to something, and "off" is the safe
// direction: the worst case is one extra keypress, versus a rotation that gets
// stuck somewhere the page is not usable.
assert.strictEqual(core.nextMode("compare", CYCLE_KEYS), "off", "an unknown mode falls back to off, not to undefined");
assert.strictEqual(core.nextMode(undefined, CYCLE_KEYS), "off", "so does no mode at all");

// index.js must derive the cycle from its own mode list rather than hard-coding
// it a second time — two lists that can disagree is how Compare would end up in
// the rotation while greyed out in the toolbar.
assert.ok(/CYCLE_KEYS\s*=\s*MODES\.filter/.test(indexSrc), "index.js derives the cycle from MODES, filtered by disabled");
assert.ok(/core\.nextMode\(/.test(indexSrc), "index.js rotates via core.nextMode rather than its own copy");

// Smoke-require index.js, mirroring the other five modules — a broken
// relative path or a missing export fails here, not on first injection.
const indexMod = require(MOD("index.js"));
assert.strictEqual(typeof indexMod.setup, "function", "index exports setup");

// ---- the module list, now that the loader is gone -------------------------
//
// serve.cjs and the overlay.js loader were retired 2026-08-07: the overlay is
// injected from disk by the Playwright process (see SKILL.md), so there is no
// server, no fetch, and no hand-maintained FILES array in a loader any more.
//
// That removed one of the two lists this suite used to cross-check, so the
// remaining one is now checked against something that cannot drift: the
// directory itself. A ninth module added to overlay/ and forgotten everywhere
// else used to reintroduce the isOwnModuleUrl self-match bug silently — Study
// reporting its own new module as a detected motion library. Now it fails here.
const onDisk = fs.readdirSync(path.join(__dirname, "overlay")).filter(function (f) { return f.endsWith(".js"); }).sort();
function extractStringArray(src, varName) {
  const m = new RegExp(varName + "\\s*=\\s*\\[([^\\]]*)\\]").exec(src);
  if (!m) return [];
  return (m[1].match(/["']([^"']+)["']/g) || []).map(function (s) { return s.slice(1, -1); });
}
const ownModuleFiles = extractStringArray(coreSrc, "OWN_MODULE_FILES");
assert.ok(ownModuleFiles.length > 0, "core.js's OWN_MODULE_FILES array is parseable");
assert.deepStrictEqual(ownModuleFiles.slice().sort(), onDisk,
  "OWN_MODULE_FILES names exactly the modules that exist on disk — no more, no fewer");

// Load order is a real dependency chain: core -> palette -> ui -> modes -> index.
// study.js requires study-motion.js, and index.js requires everything. The list
// is consumed in order by the boot snippet, so its order is load-bearing.
assert.deepStrictEqual(ownModuleFiles,
  ["core.js", "palette.js", "fontpicker.js", "fontspanel.js", "ui.js", "point.js", "measure.js", "study-motion.js", "study.js", "fonts.js", "index.js"],
  "OWN_MODULE_FILES is in dependency order — it is what the boot snippet iterates");

// SKILL.md carries the same list in its boot snippet, and prose drifts. An
// agent following a stale list boots a partial overlay that fails on the first
// missing dependency, which reads as "the tool is broken" rather than "the doc
// is stale".
const skillMdSrc = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const skillFiles = extractStringArray(skillMdSrc, "FILES");
assert.deepStrictEqual(skillFiles, ownModuleFiles,
  "SKILL.md's boot snippet lists the same modules, in the same order, as core.js");

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
// NARROWED 2026-08-07, deliberately, and this is not a guard weakened to make a
// test pass. The original rule — onClick must contain no preventDefault or
// stopPropagation at all — existed because the first version ate every link
// click and made Study a trap you could not browse out of. That requirement
// still holds in full for a PLAIN click, and is asserted as such below and in
// the Alt+click block. What changed is a product decision: Alt+click now pins a
// link without following it, because otherwise a CTA cannot be captured at all.
// One held key is the only exception, and the plain path is checked separately
// rather than by a blanket grep that can no longer distinguish the two.
assert.ok(/if \(e\.altKey\)/.test(studyOnClick),
  "the ONLY event-blocking branch in onClick is the Alt+click one");
// Cut the Alt branch out by its braces and check what is LEFT. An earlier
// version of this split on the "if (e.altKey)" text, which left the branch's own
// body in the remainder and made the assertion fail against correct code.
var plainOnly = studyOnClick.replace(/if \(e\.altKey\) \{[^}]*\}/, "");
assert.ok(!/preventDefault|stopPropagation/.test(plainOnly),
  "study.js's onClick must never block or swallow a PLAIN click — a plain link click must still navigate");

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

// The self-match guard, after serve.cjs was retired. Nothing writes a boot base
// any more — the modules are injected from disk and never appear in the page's
// resource timings at all, so there is normally nothing for isOwnModuleUrl to
// exclude and bootBase is legitimately null.
//
// The guard STAYS because the null path is the dangerous one and always was: a
// null base excludes nothing, and Study then reports its own study-motion.js as
// a detected motion library. That is still live for anyone loading the modules
// as plain <script src> tags (the local preview harness does exactly this), and
// core.isOwnModuleUrl is asserted directly above against a real base.
assert.ok(/window\.__annBootBase/.test(studyMotionSrc), "study-motion.js's fingerprint scan still prefers an in-memory boot base when one exists");
assert.ok(/bootBase = localStorage\.getItem/.test(studyMotionSrc), "and still falls back to localStorage rather than assuming one is set");

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
assert.ok(/favPanel\s*:/.test(uiSrc), "ui.js exposes favPanel as a node index.js can hand to setModeTools, not as something ui.js places itself");
assert.ok(/onFavouriteSave\s*:/.test(uiSrc), "ui.js exposes onFavouriteSave so index.js can wire the note/tag submit without ui.js knowing about study mode");

// index.js is the one that decides visibility and wires the callback through
// to studyMode.favourite() — ui.js must never call studyMode itself.
assert.ok(/setModeTools\(uiHandles\.favPanel\)/.test(indexSrc), "index.js is the one that puts the favourite panel into row 2, keeping mode logic out of ui.js");
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
// to the scale-RANGE fallback, and a range of 2 makes even 19 look far away —
// "new". A wider scale would be classified correctly by the fallback anyway and
// so would prove nothing about the line under test.
assert.strictEqual(core.classifyValue(19, ["16px", "18px"]).verdict, "conflict",
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

// ---- "nothing happens when i click save favourite" (reported live) --------
//
// Two separate defects behind one report, and every unit test and every browser
// gate was green through both of them.
//
// 1. The Study readout is up to 72vh tall and is placed relative to the cursor.
//    Phase 2 moved the toolbar from the bottom-RIGHT corner to the bottom
//    CENTRE — straight underneath it. Worse, the readout flips to
//    pointerEvents:auto whenever the cursor is over it, so reaching for the ★
//    button armed the very thing blocking it. The control was unreachable, and
//    nothing anywhere reported an error.
assert.ok(/function reservedTop\(\)/.test(studySrc), "study.js computes a floor from the toolbar's own position");
assert.ok(/ui && ui\.bar && ui\.bar\.getBoundingClientRect\(\)/.test(studySrc), "and it measures the real toolbar rather than assuming a height");
assert.ok(/panel\.style\.maxHeight = Math\.max\(120, floor - 16\)/.test(studySrc), "the readout SHRINKS to fit above the toolbar");
// maxHeight must be applied before offsetHeight is read, or the clamp is
// computed from the height the panel would have had if it were allowed to run
// long — and it lands back on top of the toolbar.
// COMMENTS STRIPPED FIRST. The first version of this compared raw indexes and
// stayed green under sabotage, because the explanatory comment directly above
// the code says the words "maxHeight" and "offsetHeight" in that order — so it
// was measuring the comment, not the code. Same shape as the `/--/` assertion
// that once matched a section banner.
var showBody = extractFunction(studySrc, "show").split("\n")
  .filter(function (l) { return l.trim().indexOf("//") !== 0; }).join("\n");
assert.ok(showBody.indexOf("maxHeight") > -1, "show() clamps maxHeight at all");
assert.ok(showBody.indexOf("offsetHeight") > -1, "show() reads offsetHeight at all");
assert.ok(showBody.indexOf("maxHeight") < showBody.indexOf("offsetHeight"),
  "maxHeight is set BEFORE offsetHeight is read, or the clamp uses a stale height");
// Belt and braces: even if the clamp were ever wrong, the toolbar outranks the
// readout in the stacking order, because the toolbar is the only way in.
assert.ok(/zIndex: Z - 2/.test(studySrc), "the readout sits BELOW the toolbar in the stacking order");

// 2. Pressing ★ changed nothing on screen whether it worked or not. A control
//    whose entire output is invisible state is indistinguishable from a broken
//    one, and the user was right to call it broken.
assert.ok(/setFavouriteStatus\s*:/.test(uiSrc), "ui.js exposes a status line for the favourite panel");
assert.ok(/Click an element on the page first/.test(indexSrc), "the no-op case says what to do instead of failing silently");
assert.ok(/★ Saved/.test(indexSrc), "and a successful save is confirmed on screen");
assert.ok(/var saved = studyMode\.favourite\(note, tags\);/.test(indexSrc), "index.js checks favourite()'s return value rather than discarding it");

// A confirmation from the PREVIOUS element must not linger over a newly pinned
// one — that is a quiet lie rather than a missing message.
assert.ok(/if \(notify\) notify\(\)/.test(studySrc), "study.js notifies on pin change");
assert.ok(/var pal = ctx\.pal, ui = ctx\.ui, notify = ctx\.notify;/.test(studySrc),
  "notify is DECLARED — an undeclared bare name throws ReferenceError inside the click handler, which presents as 'clicking does nothing'");

// ---- Phase 3: Compare — baseline vs re-run --------------------------------

// The spec names this the risky part of the phase ("Compare's delta maths"),
// and it is pure, so it gets tested properly rather than grepped for.

// Pairing across runs is the whole feature. Next appends ?_rsc=<hash> to its
// navigation payloads and that hash differs every single time — leave it on and
// NOTHING matches, so every row reads "added" and the diff quietly becomes a
// list. That failure would look like a working feature.
assert.strictEqual(core.normalisePath("https://app.test/chat?_rsc=abc123"), "/chat", "origin and query are stripped");
assert.strictEqual(core.normalisePath("https://app.test/chat?_rsc=zzz999"), "/chat", "a different hash pairs with the same route");
assert.strictEqual(core.normalisePath("/tasks#section"), "/tasks", "the hash fragment goes too");
assert.strictEqual(core.normalisePath("https://app.test"), "/", "a bare origin is the root, never empty string");

assert.strictEqual(core.entryKey({ kind: "nav", from: "/a?x=1", to: "/b?_rsc=q" }), "nav /a -> /b", "a nav is keyed on the route PAIR, not just the destination");
assert.strictEqual(core.entryKey({ kind: "action", url: "https://app.test/chat?_rsc=1" }), "action /chat", "an action is keyed on its path");
assert.strictEqual(core.entryKey({ kind: "longtask", ms: 90 }), "longtask", "a long task has no identity, so it aggregates by kind");
assert.strictEqual(core.entryKey({ kind: "dropped", n: 12 }), null, "a dropped marker is bookkeeping, never a measurement");

// A cache-served nav has no rscMs at all. Reading only rscMs would drop every
// cache hit out of the comparison — the fast ones, silently.
assert.strictEqual(core.entryMetric({ kind: "nav", rscMs: 120, toPaintMs: 300 }), 120, "nav prefers the server's own time");
assert.strictEqual(core.entryMetric({ kind: "nav", rscMs: null, toPaintMs: 40 }), 40, "a cache-served nav still contributes its paint time");
assert.strictEqual(core.entryMetric({ kind: "shift", value: 0.12 }), 0.12, "a layout shift is scored on its value");
assert.strictEqual(core.entryMetric({ kind: "action", ms: 0 }), 0, "a genuine zero is a measurement, not a missing one");

// Summarising.
var runA = [
  { kind: "action", url: "/chat", ms: 100 },
  { kind: "action", url: "/chat", ms: 200 },
  { kind: "nav", from: "/", to: "/tasks", rscMs: 50 }
];
var sumA = core.summariseRun(runA);
assert.strictEqual(sumA.byKey["action /chat"].n, 2, "two samples collapse into one key");
assert.strictEqual(sumA.byKey["action /chat"].mean, 150, "mean of 100 and 200");
assert.strictEqual(sumA.byKey["action /chat"].min, 100, "min tracked");
assert.strictEqual(sumA.byKey["action /chat"].max, 200, "max tracked");
assert.strictEqual(sumA.truncated, false, "a complete run is not truncated");

// The comparison itself.
var base = [{ kind: "action", url: "/chat", ms: 400 }, { kind: "action", url: "/chat", ms: 400 },
            { kind: "nav", from: "/", to: "/tasks", rscMs: 100 }, { kind: "nav", from: "/", to: "/tasks", rscMs: 100 }];
var next = [{ kind: "action", url: "/chat", ms: 100 }, { kind: "action", url: "/chat", ms: 100 },
            { kind: "nav", from: "/", to: "/tasks", rscMs: 300 }, { kind: "nav", from: "/", to: "/tasks", rscMs: 300 },
            { kind: "img", url: "/img/a.png", ms: 80 }];
var cmp = core.compareRuns(base, next);
var cmpBy = {};
cmp.rows.forEach(function (r) { cmpBy[r.key] = r; });
assert.strictEqual(cmpBy["action /chat"].verdict, "faster", "400ms -> 100ms is faster");
assert.strictEqual(cmpBy["action /chat"].deltaMs, -300, "the delta is signed against the baseline");
assert.strictEqual(cmpBy["nav / -> /tasks"].verdict, "slower", "100ms -> 300ms is a regression");
assert.strictEqual(cmpBy["img /img/a.png"].verdict, "added", "something only in the new run is 'added', never a 200% regression");
assert.strictEqual(cmpBy["img /img/a.png"].deltaMs, null, "an added row has no delta to report");

// Every key lands in exactly one row — a key falling through all the branches
// would be a measurement silently dropped from the user's comparison.
assert.strictEqual(cmp.rows.length, 3, "three distinct keys, three rows");
assert.strictEqual(cmp.regressions.length, 1, "regressions-only filter isolates the nav");
assert.strictEqual(cmp.regressions[0].key, "nav / -> /tasks", "and it is the right one");

// A key present only in the baseline is "gone", not a 100% improvement.
var goneCmp = core.compareRuns([{ kind: "action", url: "/old", ms: 500 }], []);
assert.strictEqual(goneCmp.rows[0].verdict, "gone", "something that stopped happening is 'gone'");
assert.strictEqual(goneCmp.regressions.length, 0, "and it is not counted as a regression");

// BOTH noise floors must clear. This is what stops the tool reporting a win a
// second run would not reproduce.
var pctOnly = core.compareRuns([{ kind: "action", url: "/x", ms: 20 }], [{ kind: "action", url: "/x", ms: 16 }]);
assert.strictEqual(pctOnly.rows[0].verdict, "same", "4ms off 20ms is 20% but only 4ms — noise, not a win");
var absOnly = core.compareRuns([{ kind: "action", url: "/x", ms: 30000 }], [{ kind: "action", url: "/x", ms: 29600 }]);
assert.strictEqual(absOnly.rows[0].verdict, "same", "400ms off 30s is a big number but 1.3% — noise, not a win");
var real = core.compareRuns([{ kind: "action", url: "/x", ms: 400 }], [{ kind: "action", url: "/x", ms: 100 }]);
assert.strictEqual(real.rows[0].verdict, "faster", "clearing both floors is a real result");

// One observation each side is an anecdote, and the row has to say so — this is
// the same mistake as the finding that evaporated on a prod build.
assert.strictEqual(real.rows[0].thin, true, "one sample each side is flagged thin");
assert.strictEqual(cmpBy["action /chat"].thin, false, "two samples each side is not");

// Truncation must never read as a complete comparison.
var trunc = core.compareRuns([{ kind: "dropped", n: 37 }, { kind: "action", url: "/x", ms: 10 }],
                             [{ kind: "action", url: "/x", ms: 10 }]);
assert.strictEqual(trunc.truncated, true, "a dropped marker on either side truncates the whole comparison");
assert.strictEqual(trunc.dropped.before, 37, "and reports how many entries were lost");
assert.strictEqual(trunc.rows.length, 1, "the dropped marker itself is not a row");

// Worst regression first: it is the thing the run was done to find.
assert.strictEqual(cmp.rows[0].verdict, "slower", "regressions sort to the top");

// Two empty runs must not throw — the user WILL press this before recording.
var empty = core.compareRuns([], []);
assert.deepStrictEqual(empty.rows, [], "comparing nothing to nothing is an empty diff, not a crash");
assert.strictEqual(empty.truncated, false, "and it is not truncated");

// ---- Phase 3: Compare's wiring --------------------------------------------

// take() DRAINS, and the watch loop calls it every ~25s — so a Compare built on
// take() would silently compare "whatever happened in the last few seconds"
// against the baseline. measure.js keeps a separate non-draining session log.
assert.ok(/sessionTake\s*:\s*sessionTake/.test(measureSrc), "measure.js exposes sessionTake for Compare");
assert.ok(/var out = session\.slice\(\)/.test(measureSrc), "sessionTake hands out a COPY — a baseline that mutates afterwards is worse than none");
assert.ok(/session = \[\]; sessionDropped = 0;/.test(measureSrc), "a new recording session resets the log");

// The session log is fed by wrapping buf.push ONCE, not by editing the six
// call sites — so a future entry kind cannot forget to join in.
assert.ok(/var buf = \{ push: function \(e\) \{/.test(measureSrc), "measure.js wraps push in one place rather than at every call site");
assert.strictEqual((measureSrc.match(/session\.push\(/g) || []).length, 1, "exactly one place appends to the session log");

// Its cap and its drop counter mirror the perf buffer's, because a truncated
// session compared against a complete baseline is comparing different things.
assert.ok(/if \(session\.length > 500\) \{ session\.shift\(\); sessionDropped\+\+; \}/.test(measureSrc), "the session log caps and counts its own drops");
assert.ok(/kind: "dropped", n: sessionDropped/.test(measureSrc), "and reports them in the shape summariseRun understands");

// index.js's entry points.
assert.ok(/window\.__annotatorCompareTake = function/.test(indexSrc), "index.js exposes __annotatorCompareTake");
assert.ok(/window\.__annotatorCompareSaveBaseline = function/.test(indexSrc), "index.js exposes __annotatorCompareSaveBaseline");
assert.ok(/window\.__annotatorCompareClearBaseline = function/.test(indexSrc), "index.js exposes __annotatorCompareClearBaseline");

// A caller that only ever sees regressions cannot tell "nothing got worse" from
// "nothing was measured in both runs", and those need different answers.
// Anchored on the semicolon: without it the pattern is a SUBSTRING match and
// stays green against `...sessionTake()).regressions;` — the exact narrowing
// it is meant to catch. Caught by sabotage, not by reading.
assert.ok(/return core\.compareRuns\(b\.entries, measureMode\.sessionTake\(\)\);/.test(indexSrc), "compareTake returns the full result, not a pre-filtered list");
assert.ok(/error: "no-baseline"/.test(indexSrc), "and says so explicitly when there is no baseline, rather than returning an empty diff");

// The baseline goes to localStorage, not memory: the entire point is that the
// agent works in between, and editing a component the page uses triggers an HMR
// reload that would take an in-memory baseline with it.
assert.ok(/localStorage\.setItem\(BASELINE_KEY/.test(indexSrc), "the baseline is persisted, not held in memory");
assert.ok(/catch \(e\) \{[\s\S]{0,160}?Could not save the baseline/.test(indexSrc), "a refused write is reported, never swallowed into a silent no-op");

// Compare must be a live tab now, and must not have quietly become a dead stop
// in the Alt+A rotation.
assert.ok(!/key: "compare"[^}]*disabled/.test(indexSrc), "Compare is no longer disabled");
assert.ok(/key: "compare"[^}]*Baseline vs re-run/.test(indexSrc), "and its tooltip says what it does");

// ---- Alt+click: the only place Study may stop an event ---------------------

// Verified live 2026-08-07: clicking a CTA in Study mode pinned it AND followed
// the href, and the navigation tore the overlay off the page before anything
// could be saved. The most-studied element on the web was the one thing this
// tool could not capture. Matt's call: a held key pins without navigating.
var studyClick = extractFunction(studySrc, "onClick");
assert.ok(studyClick.length > 0, "found study.js's onClick to inspect");
assert.ok(/if \(e\.altKey\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}/.test(studyClick),
  "Alt+click both prevents the default AND stops propagation");

// stopPropagation is not belt-and-braces here. Plenty of sites navigate from
// their own JS click handler rather than from an href, and preventDefault says
// nothing to those. Study's listener is on document in the capture phase, so
// stopping there is what keeps the page still.
assert.ok(/document\.addEventListener\("click", onClick, true\)/.test(studySrc),
  "Study's click listener is in the capture phase, which is what makes stopPropagation reach page handlers");

// The un-modified path must stay untouched: browsing a site is how you reach
// what you want to study, and eating every link click was a Phase 1a bug.
var plainPath = studyClick.replace(/if \(e\.altKey\) \{[^}]*\}/, "");
assert.ok(!/preventDefault/.test(plainPath), "a plain click still never prevents the default");
assert.ok(!/stopPropagation/.test(plainPath), "a plain click still never stops propagation");

// Alt+click must fall through to the SAME pin/unpin body, not fork into a second
// copy that can forget the favData/lastEl resets.
assert.strictEqual((studyClick.match(/favData = null/g) || []).length, 2,
  "one pin path and one unpin path — Alt+click does not add a third copy of the reset");

// ---- The relaxed default, and why it is a product decision ----------------

// Matt's ruling 2026-08-07: the tool is for INSPIRATION, not transcription.
// Under that use a value landing near an existing token is the normal case and
// mostly wants adapting, not a decision — so the default band was relaxed from
// 0.5 to 0.25. A warning that fires on every near-miss gets clicked past.
assert.strictEqual(core.classifyValue(20, [6, 10, 16, 999]).verdict, "conflict",
  "20 against 16 (4px apart) still collides — this is the case the feature exists for");
assert.strictEqual(core.classifyValue(24, [6, 10, 16, 999]).verdict, "new",
  "24 against 16 (8px apart) is now a separate size, not a collision — the relaxation, asserted");

// The threshold stays overridable, because the right band is a matter of taste
// and this is the knob that gets tuned once there is a real design doc behind it.
assert.strictEqual(core.classifyValue(24, [6, 10, 16, 999], { threshold: 0.5 }).verdict, "conflict",
  "the old band is still reachable by passing threshold explicitly");

// The whole "is this page light or dark" apparatus — the canvas luminance probe,
// the inference from text colour when a page paints no background (stripe.com),
// the fallbackBg ladder — went with the hardcoded palette above. It is not
// missing; nothing asks the question any more.
assert.strictEqual(palette.fallbackBg, undefined, "the light/dark inference is gone, not merely unused");

// ---- Phase 2: the Layout B toolbar ----------------------------------------

// Every control in ui.js is wired through ONE delegated listener on document in
// the CAPTURE phase. Not tidiness: linear.app's own capture handler called
// stopPropagation and the first click on a toolbar button reached
// document-capture with the right target and then never arrived at the button.
// A per-button listener sits downstream of that and simply loses; a listener
// already on document cannot be silenced by stopPropagation from at or below it.
// The failure this prevents is the entire tool — the toolbar is the only way in.
//
// This began as "exactly one listener" and is now "exactly one PER EVENT TYPE,
// all delegated, all capture" — because Fonts mode added a <select> and a
// datalist <input>, which report through `change` and never fire the click
// listener at all. The count was never the invariant; delegation from document
// in the capture phase is. Pinning the type list keeps a third listener from
// being added casually while letting the real reason for a second one through.
var uiDocTypes = (uiSrc.match(/document\.addEventListener\("([a-z]+)"/g) || [])
  .map(function (s) { return /"([a-z]+)"/.exec(s)[1]; }).sort();
assert.deepStrictEqual(uiDocTypes, ["change", "click"],
  "ui.js delegates through exactly one document listener per event type, got " + JSON.stringify(uiDocTypes));
var uiDocRaw = uiSrc.match(/document\.addEventListener\(/g) || [];
assert.strictEqual(uiDocRaw.length, uiDocTypes.length,
  "every document listener in ui.js names a literal event type — a computed one cannot be checked here");

// fontpicker.js is chrome too, and the picker is the only way to choose a font
// — so the same rule binds it. Its listeners must be on document, in capture,
// one per type, or a host page that eats propagation makes the picker inert.
var fpSrc = fs.readFileSync(MOD("fontpicker.js"), "utf8");
var fpDocTypes = (fpSrc.match(/document\.addEventListener\("([a-z]+)"/g) || [])
  .map(function (s) { return /"([a-z]+)"/.exec(s)[1]; }).sort();
assert.deepStrictEqual(fpDocTypes, ["click", "keydown"],
  "fontpicker.js delegates through exactly one document listener per event type, got " + JSON.stringify(fpDocTypes));
fpDocTypes.forEach(function (type) {
  assert.ok(new RegExp('document\\.addEventListener\\("' + type + '",[\\s\\S]{0,2400}?\\}, true\\);').test(fpSrc),
    "fontpicker.js's " + type + " listener is registered in the CAPTURE phase");
});
assert.ok(/document\.addEventListener\("click",[\s\S]{0,900}?\}, true\);/.test(uiSrc),
  "ui.js's delegated click listener is registered in the CAPTURE phase");
assert.ok(/document\.addEventListener\("change",[\s\S]{0,600}?\}, true\);/.test(uiSrc),
  "ui.js's delegated change listener is registered in the CAPTURE phase too — a bubble-phase one loses to the same stopPropagation");
// The change path needs the SAME two guards the click path has, or a host page
// with its own data-ann-change attribute could drive our fonts rows.
assert.ok(/closest\("\[data-ann-change\]"\)/.test(uiSrc), "the delegated change listener resolves the control via closest()");

// Delegation is only safe if it refuses to act on the host page's own markup —
// a site with its own data-ann-mode attribute must not be able to drive us.
assert.ok(/closest\("\[data-ann-act\],\[data-ann-mode\]"\)/.test(uiSrc), "the delegated listener resolves the control via closest()");
assert.ok(/if \(!hit \|\| !isOurs\(hit\)\) return;/.test(uiSrc), "the delegated listener ignores anything that is not our own chrome");

// A disabled button must be inert through the delegated path too. `disabled` on
// a <button> stops its OWN listener firing, but says nothing about a delegated
// one reading the attribute off it — so Compare would have been live.
assert.ok(/if \(hit\.disabled\) return;/.test(uiSrc), "the delegated listener honours disabled, which a delegated path does not get for free");

// The toolbar's second row must collapse rather than sit empty over the page.
assert.ok(/if \(!node\) \{ row2\.style\.display = "none"; return; \}/.test(uiSrc), "setModeTools(null) collapses row 2");

// The queue is on demand, and ui.js still holds no annotation state — the
// existing "__annotations" guard above covers that and re-runs here.
assert.ok(/setQueueItems\s*:/.test(uiSrc), "ui.js exposes setQueueItems so index.js can hand it rows");
assert.ok(/setQueueCount\s*:/.test(uiSrc), "ui.js exposes setQueueCount");

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

// ---- Fonts mode: the family-name parser ------------------------------------
//
// The whole mode groups elements by "which font is this in", and that group key
// comes from a computed `font-family` string — which is a LIST, quoted
// inconsistently by every engine. Get this wrong and two slots silently merge
// (or one splits in half) with nothing on screen to say so.
assert.strictEqual(typeof core.firstFamily, "function", "core exports firstFamily");
assert.strictEqual(core.firstFamily('"Inter", -apple-system, sans-serif'), "Inter", "strips double quotes, takes the first");
assert.strictEqual(core.firstFamily("Inter, sans-serif"), "Inter", "unquoted names work");
assert.strictEqual(core.firstFamily("'Playfair Display', serif"), "Playfair Display", "single quotes, spaces kept");
assert.strictEqual(core.firstFamily("  Inter  ,  serif "), "Inter", "trims around the name");
// A generic is a legitimate group: every element that inherited the page
// default really is one font, and refusing to slot it would make the most
// common case on an unstyled page unclickable.
assert.strictEqual(core.firstFamily("sans-serif"), "sans-serif", "a bare generic is still a slot");
// The case a naive split(",")[0] gets wrong. Rare, but it fails SILENTLY —
// half a font name as a group key matches nothing and the swap appears dead.
assert.strictEqual(core.firstFamily('"Foo, Bar", serif'), "Foo, Bar", "a comma INSIDE quotes is part of the name");
assert.strictEqual(core.firstFamily('"Say \\"Hi\\"", serif'), 'Say "Hi"', "escaped quotes unescape");
// Nothing to group by must be falsy, never the string "undefined" — index.js
// tests the result to decide whether a click made a slot at all.
assert.strictEqual(core.firstFamily(""), "", "empty string in, empty string out");
assert.strictEqual(core.firstFamily(null), "", "null is not a font");
assert.strictEqual(core.firstFamily(undefined), "", "undefined is not a font");

// ---- Fonts mode -----------------------------------------------------------

const fontsSrc = fs.readFileSync(MOD("fonts.js"), "utf8");

// `window` must exist BEFORE fonts.js is required: the module resolves its
// window reference once at load time (it has to — a bare `window` mention is a
// ReferenceError in Node, which is where this suite runs it). Assigning it after
// the require would leave the module holding null and every browser path would
// short-circuit, passing for the wrong reason.
const winStub = {
  isSecureContext: true,
  navigator: { permissions: { query: function () { return Promise.resolve({ state: winStub.__perm || "prompt" }); } } }
};
global.window = winStub;
const fontsMod = require(MOD("fonts.js"));
assert.strictEqual(typeof fontsMod.create, "function", "fonts exports create");
assert.ok(fontsMod.WEB_FONTS.length > 20, "the curated web list is actually a list");
assert.strictEqual(fontsMod.WEIGHTS[0], "keep", "'keep' is the default weight — a mode that silently reweights text is lying about what it changed");

// Fonts is the one mode that writes to the host page, so the two rules that
// keep that honest are asserted, not trusted.
//
// 1. It must skip our own chrome. Without this the sweep restyles the toolbar
//    it is being driven from, mid-click.
assert.ok(/closest\(["']\.__ann-ui["']\)/.test(fontsSrc), "fonts.js skips .__ann-ui when sweeping — otherwise it restyles the toolbar");
// 2. It must read the previous inline value BEFORE writing. Reset is the whole
//    promise of this mode; a revert that writes "" instead of what was there
//    silently deletes a style the page author wrote.
assert.ok(/getPropertyValue\(prop\)/.test(fontsSrc), "fonts.js records the previous inline value of every property it touches");
assert.ok(/getPropertyPriority\(prop\)/.test(fontsSrc), "fonts.js records the previous !important flag too — restoring the value without it is still a change");

// THE rule that keeps Reset honest as the suite grows. Every property written
// has to be one the snapshot/restore loop covers; a property added to
// declarationsFor and forgotten in TOUCHED is a change that outlives Reset, and
// nothing on screen would ever say so. Checked by extracting both lists from the
// source, so adding a tenth control cannot quietly break it.
const touchedList = extractStringArray(fontsSrc, "TOUCHED");
assert.ok(touchedList.length >= 9, "TOUCHED is parseable and covers the suite, got " + touchedList.length);
const writtenProps = (fontsSrc.match(/out\["([a-z-]+)"\]\s*=/g) || []).map(function (s) { return /"([a-z-]+)"/.exec(s)[1]; });
assert.ok(writtenProps.length >= 9, "declarationsFor writes the whole suite, got " + writtenProps.length);
writtenProps.forEach(function (prop) {
  assert.ok(touchedList.indexOf(prop) !== -1,
    "every property fonts.js writes is one it snapshots and restores — '" + prop + "' is not in TOUCHED, so Reset would leave it behind");
});

// This assertion used to say the OPPOSITE — that queryLocalFonts must never be
// called, because its permission prompt would have nobody to answer it. That was
// wrong, and it cost the picker 90% of the machine's fonts: a Playwright context
// can grant `local-fonts` outright, and with it granted there is no prompt at
// all. Measured 2026-08-20: 449 families enumerated against 43 the probe list
// could find, and the missing ones were the bought and bundled faces that are
// the whole reason to browse your own fonts.
//
// Checked against CODE, not prose — fonts.js explains this in a comment, and a
// grep over raw source matches the explanation as readily as the call.
const fontsCode = codeOf(fontsSrc);
assert.ok(/queryLocalFonts\(\)/.test(fontsCode), "fonts.js enumerates the real system font list");
// Both halves matter: enumeration can be refused (no permission, older browser,
// a prompt nobody answers), and a picker that then shows nothing is worse than
// one showing a curated handful.
assert.ok(/probedLocalNames/.test(fontsCode), "the measurement probe survives as the fallback when enumeration is refused");
assert.ok(/ENUM_CEILING_MS/.test(fontsCode), "enumeration has a ceiling — an unanswered permission prompt never settles at all");
assert.ok(/catalogueNote/.test(fontsCode), "a fallback catalogue announces itself rather than looking like the whole list");
assert.ok(/setNote/.test(fpSrc), "the picker has somewhere to show that note");

// ---- the short list has to say WHY, and offer the fix ----------------------
//
// Reported live 2026-08-20: the picker showed the curated 82 with the single
// line "this browser would not read your installed fonts", which names neither
// the cause nor a remedy. Four different things produce that same short list and
// they need four different answers — and until now the permission could only be
// obtained OUT OF BAND, from a grantPermissions call in the boot snippet, so a
// session that booted without it had no way back at all.
assert.ok(/isSecureContext/.test(fontsCode), "an http page hides the API outright — that is a different problem from a refused permission, and says so");
assert.ok(/navigator\.permissions/.test(fontsCode), "the real permission state is read, not guessed");
["insecure", "unsupported", "denied"].forEach(function (cause) {
  assert.ok(new RegExp('"' + cause + '"').test(fontsCode), "the diagnosis distinguishes the '" + cause + "' case");
});
assert.ok(/requestSystemFonts/.test(fontsCode), "the permission can be requested from inside the page");
assert.ok(/onGrant/.test(fpSrc) && /data-ann-fp-grant/.test(fpSrc), "and the picker gives that request a button");
assert.ok(/onGrantFonts/.test(indexSrc), "index.js wires the button to the mode");

// THE caller-side half of the rule above, and the actual regression. A one-shot
// bootstrap must not be invoked from the repaint function, because its callback
// IS the repaint: updateToolbar -> loadSystemFonts -> onDone -> updateToolbar,
// forever, and the overlay dies on stack exhaustion the moment Fonts is opened.
// Checked by carving updateToolbar out of the source rather than by grepping the
// whole file, since the legitimate call site sits a few lines below it.
const updateToolbarBody = /function updateToolbar\(\) \{([\s\S]*?)\n    \}/.exec(indexSrc);
assert.ok(updateToolbarBody, "updateToolbar is parseable");
["loadSystemFonts", "refreshPermission"].forEach(function (oneShot) {
  assert.ok(updateToolbarBody[1].indexOf(oneShot) === -1,
    oneShot + "() must not be called from updateToolbar — its callback repaints, and the repaint would call it again");
});
assert.ok(/if \(next === "fonts"\) \{[\s\S]{0,400}?loadSystemFonts/.test(indexSrc),
  "it runs on entering the mode instead, where the callback leads nowhere back");

// Enumeration is one-shot AND flaky — the same page gave 82 on one run and 488
// on the next with the permission granted both times — so a lost race would
// otherwise strand the curated list for the whole page. The retry must be gated
// on BOTH the permission being granted and the list still being short: either
// alone would re-ask on every mode entry for a machine that will never answer,
// and both go false the moment it succeeds, so it cannot spin.
assert.ok(/accessState\(\) === "granted" && [\s\S]{0,120}?fontsFrom !== "system"/.test(indexSrc),
  "the retry is gated on a granted permission AND a still-short list");

// THE constraint that makes the button work at all. Chrome shows the permission
// prompt only while the user activation from the click is still live, and a
// single `await` before queryLocalFonts() spends it — so the path from the click
// handler down to the call must not go through one. Asserted because the failure
// is invisible: the prompt simply never appears and the list stays short.
const grantPath = /if \(state\.onGrant\) state\.onGrant\(\);/.test(fpSrc);
assert.ok(grantPath, "the picker calls the grant handler straight from the click handler");
const loadBody = /function loadSystemFonts\(onDone[^)]*\) \{([\s\S]*?)\n  \}/.exec(fontsCode);
assert.ok(loadBody, "loadSystemFonts is parseable");
assert.ok(!/\bawait\b/.test(loadBody[1]), "no await between the click and queryLocalFonts() — it would spend the user activation the prompt needs");

// The picking affordances Fonts shipped without, both reported live 2026-08-20.
assert.ok(/ui\.setCrosshair\(true\)/.test(fontsCode), "fonts mode shows the crosshair while it is picking");
assert.ok(/setCrosshair/.test(uiSrc), "ui.js owns the crosshair");
assert.ok(!/classList\.(add|remove)\("__ann-cross"\)/.test(pointSrc),
  "point.js goes through ui.setCrosshair rather than keeping its own copy — the duplicate is why Fonts shipped without a cursor");
assert.ok(/data-ann-font-pick/.test(fontsCode) && /data-ann-font-pick/.test(uiSrc),
  "the picked group stays outlined via an attribute the stylesheet draws, so it survives scrolling");
assert.ok(/focusSlot\(null\)/.test(fontsCode), "the outline is cleared when the mode is left — the swaps stay, the picking aid does not");

// The css2 endpoint returns 400 for a weight a family does not ship, which would
// break that family's row and nothing else — the most annoying kind of bug to
// track down. v1 drops unavailable variants silently.
assert.ok(/fonts\.googleapis\.com\/css\?/.test(fontsSrc), "fonts.js uses the lenient v1 CSS endpoint");
assert.ok(!/css2\?/.test(fontsSrc), "fonts.js does not use css2 (it 400s on a weight a family lacks)");

// Found live 2026-08-20: probing document.fonts straight after appending the
// <link> resolves with an empty face list, because the stylesheet has not been
// parsed yet — so a font that loaded fine accused the site of blocking it. The
// link's own load/error events are the only signal that is not a race.
assert.ok(/link\.onload\s*=/.test(fontsCode), "fonts.js waits for the stylesheet's load event before judging whether the font arrived");
assert.ok(/link\.onerror\s*=/.test(fontsCode), "fonts.js treats the link's error event as the blocked case");
assert.ok(fontsCode.indexOf("link.onload") < fontsCode.indexOf("document.head.appendChild(link)"),
  "the handlers are attached BEFORE the link is appended — attaching after it is a second race, on a cached stylesheet");

// ui.js stays mode-blind: it draws the panel, index.js decides it means fonts.
assert.ok(/fontsPanel\s*:/.test(uiSrc), "ui.js exposes fontsPanel as a node index.js can hand to setModeTools");
assert.ok(!/fontsMode/.test(uiSrc), "ui.js never calls the fonts mode directly");
assert.ok(/setModeTools\(uiHandles\.fontsPanel\)/.test(indexSrc), "index.js is the one that puts the fonts panel into row 2");
assert.ok(/\{ key: "fonts"/.test(indexSrc), "index.js lists Fonts in MODES, so it joins the Alt+A cycle by derivation rather than by hand");

// ---- the swap/revert logic, actually run ----------------------------------
//
// The two failures this catches are both silent and both destructive: a slot
// stealing another slot's elements (so a swap you did not ask for follows you
// around), and a revert that does not restore exactly what was there (so the
// page keeps a change after Reset says it is clean). A fake DOM is cheap enough
// to make both of them fail here instead of on Matt's screen.
function fakeStyle() {
  return {
    _v: {}, _p: {},
    getPropertyValue: function (k) { return this._v[k] || ""; },
    getPropertyPriority: function (k) { return this._p[k] || ""; },
    setProperty: function (k, v, p) { this._v[k] = v; this._p[k] = p || ""; },
    removeProperty: function (k) { delete this._v[k]; delete this._p[k]; }
  };
}
// Every fixture element sits in one div. A pick groups by tag + class inside
// that div, so `tag`/`cls` decide which elements count as "like" each other.
const fakeDiv = {
  closest: function (sel) { return sel === "div" ? fakeDiv : null; },
  querySelectorAll: function (tag) { return DOM.filter(function (e) { return e.tagName === tag; }); }
};
function fakeEl(name, computedFamily, sizePx, tag, cls) {
  return {
    name: name, _family: computedFamily, _size: (sizePx || 16) + "px", style: fakeStyle(), _attrs: {},
    tagName: tag || "SPAN", parentElement: fakeDiv,
    getAttribute: function (k) { return k === "class" ? (cls || null) : null; },
    closest: function () { return null; },
    setAttribute: function (k, v) { this._attrs[k] = v; },
    removeAttribute: function (k) { delete this._attrs[k]; },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); }
  };
}
// Which elements currently carry the picked-group outline.
function marked() { return DOM.filter(function (e) { return e.hasAttribute("data-ann-font-pick"); }).map(function (e) { return e.name; }); }

const INSTALLED = ["Futura", "Inter"];
// Deliberately DIFFERENT sizes in one group: an h1 at 48 and an h2 at 24 are the
// case that decides whether the size control scales or flattens.
// h1, h2 and legacy share a tag and class, so they are one group.
const h1 = fakeEl("h1", "HeadingFont", 48, "H2", "title");
const h2 = fakeEl("h2", "HeadingFont", 24, "H2", "title");
const span = fakeEl("span", "Futura", 16);
const p = fakeEl("p", "BodyFont", 17, "P");
// Same font, same tag, different class: NOT like the headings.
const eyebrow = fakeEl("eyebrow", "HeadingFont", 11, "H2", "eyebrow");
// A page whose author already set an inline font-family, with !important. It is
// still in the heading group (that IS its computed font), and it is the element
// that proves revert restores rather than clears.
const legacy = fakeEl("legacy", "HeadingFont", 20, "H2", "title");
legacy.style.setProperty("font-family", '"HeadingFont", serif', "important");
// Captured while the page is still pristine — the whole point is to compare
// against what the author wrote, not against a state the tool already touched.
const PRISTINE_LEGACY = JSON.stringify({ v: legacy.style._v, p: legacy.style._p });
const DOM = [h1, h2, span, p, legacy, eyebrow];

const docHandlers = {};
global.document = {
  addEventListener: function (type, fn) { docHandlers[type] = fn; },
  removeEventListener: function (type) { delete docHandlers[type]; },
  // Selector-aware enough for the two queries fonts.js actually makes: the
  // full sweep, and the "what is currently outlined" lookup.
  querySelectorAll: function (sel) {
    if (sel === "*") return DOM;
    var m = /^\[([a-z-]+)\]$/.exec(sel);
    if (m) return DOM.filter(function (e) { return e.hasAttribute(m[1]); });
    return [];
  },
  head: { appendChild: function () {} },
  createElement: function () {
    return { getContext: function () {
      return {
        font: "",
        // Deterministic stand-in for real text measurement: a font stack whose
        // FIRST family is installed measures differently from the bare generic.
        measureText: function () {
          var first = core.firstFamily(String(this.font).replace(/^\d+px\s+/, ""));
          return { width: INSTALLED.indexOf(first) !== -1 ? 100 : 50 };
        }
      };
    } };
  }
};
global.getComputedStyle = function (el) {
  return {
    fontFamily: el.style.getPropertyValue("font-family") || el._family,
    fontSize: el.style.getPropertyValue("font-size") || el._size,
    lineHeight: el.style.getPropertyValue("line-height") || "normal",
    letterSpacing: el.style.getPropertyValue("letter-spacing") || "normal"
  };
};
global.location = { href: "https://example.com/pricing" };

const crosshair = [];
const fm = fontsMod.create({
  ui: {
    isOurs: function () { return false; },
    showHighlight: function () {}, hideHighlight: function () {},
    setCrosshair: function (on) { crosshair.push(on); }
  },
  notify: function () {}
});

const cat = fm.available();
assert.ok(cat.some(function (f) { return f.name === "Futura" && f.source === "local"; }), "an installed font is offered as local");
assert.ok(cat.some(function (f) { return f.name === "Playfair Display" && f.source === "web"; }), "a font that is not installed but is curated is offered as web");
assert.ok(!cat.some(function (f) { return f.name === "Papyrus"; }), "a candidate that is neither installed nor curated is not offered at all");

// One click makes one slot covering every element in that font.
assert.strictEqual(fm.slotCount(), 0, "no slots before anything is clicked");
fm.setFont(1, "Futura", "keep");   // no such slot yet — must be a no-op, not a throw
assert.strictEqual(fm.slotCount(), 0, "setFont on a slot that does not exist is a no-op");

// pick() is internal; drive it the way the page does.
fm.enable();
assert.strictEqual(typeof docHandlers.click, "function", "fonts mode attaches its click handler on enable()");
function click(el, opts) {
  docHandlers.click(Object.assign({ target: el, shiftKey: false, altKey: false, preventDefault: function () {}, stopPropagation: function () {} }, opts || {}));
}
assert.deepStrictEqual(crosshair, [true], "entering fonts mode turns the picking cursor on");
click(h1);
assert.strictEqual(fm.slotCount(), 1, "clicking text creates one slot");
// The complaint this came from: the highlight lasted exactly as long as the
// cursor stayed on the element, so nothing showed which elements a card owned.
assert.deepStrictEqual(marked().sort(), ["h1", "h2", "legacy"], "clicking outlines the element and its look-alikes in the same div — not every element in that font");
// The controls open on the element you CLICKED, not on whichever member of the
// group happens to come first in the markup. This page's heading group spans
// 48px, 24px and 20px — first-in-DOM would open the size control on an outlier.
assert.strictEqual(fm.rows()[0].base.sizePx, 48, "the sliders are calibrated to the element that was clicked");
// h1 is ALSO first in the fixture, so the assertion above passes either way and
// proves nothing on its own. Clicking a later member is what separates "the one
// you clicked" from "the one that came first".
click(h2);
assert.strictEqual(fm.rows()[0].base.sizePx, 24, "clicking a different member of the same group re-calibrates to THAT element");
click(h1);
assert.strictEqual(fm.rows()[0].label, "HeadingFont", "the slot is keyed on the font, not the element");
assert.strictEqual(fm.rows()[0].detail, "3 elements", "the slot covers the look-alikes (h1, h2 and the legacy one), not the same-font eyebrow with a different class");

click(h2);
assert.strictEqual(fm.slotCount(), 1, "a second element in the SAME font joins the existing slot rather than making a duplicate");

const slotId = fm.rows()[0].id;
fm.setFont(slotId, "Futura", "700");
assert.strictEqual(h1.style.getPropertyValue("font-family"), '"Futura", "HeadingFont"', "the swap keeps the original family as the fallback");
assert.strictEqual(h1.style.getPropertyPriority("font-family"), "important", "the swap wins against the page's own stylesheet");
assert.strictEqual(h1.style.getPropertyValue("font-weight"), "700", "an explicit weight is applied");
assert.strictEqual(p.style.getPropertyValue("font-family"), "", "an element in a different font is untouched");

// THE ownership case. span was already in Futura; the heading slot has just
// turned h1/h2/legacy into Futura too. A second slot for Futura must claim only
// span — not the elements the first slot is holding.
click(span);
assert.strictEqual(fm.slotCount(), 2, "a font the page already used gets its own slot");
assert.deepStrictEqual(marked(), ["span"], "focus follows the newest pick, and the previous card's outline goes with it");
const futuraRow = fm.rows()[1];
assert.strictEqual(futuraRow.label, "Futura", "the second slot is keyed on Futura");
assert.strictEqual(futuraRow.detail, "1 element", "the second slot claims only the element it really owns, not the first slot's swapped ones");

fm.setFont(futuraRow.id, "Inter", "keep");
assert.strictEqual(span.style.getPropertyValue("font-family"), '"Inter", "Futura"', "the second slot swaps its own element");
assert.strictEqual(h1.style.getPropertyValue("font-family"), '"Futura", "HeadingFont"', "and leaves the first slot's elements exactly where they were");
assert.strictEqual(h1.style.getPropertyValue("font-weight"), "700", "including their weight");

// Clicking an element the tool has already swapped re-selects its slot rather
// than creating a third one keyed on the font we ourselves just applied.
click(h1);
assert.strictEqual(fm.slotCount(), 2, "clicking an already-swapped element does not spawn a slot for our own swap");

const taken = fm.take();
assert.strictEqual(taken.url, "https://example.com/pricing", "take() reports where the pairing was seen");
assert.deepStrictEqual(
  taken.swaps.map(function (s) { return [s.from, s.to, s.weight, s.count, s.source]; }),
  [["HeadingFont", "Futura", "700", 3, "local"], ["Futura", "Inter", null, 1, "local"]],
  "take() reports both halves of the pairing, with the element count that proves each one landed"
);

// ---- the whole typographic suite, applied and then undone -----------------
//
// The round trip is the test that matters. Every control writes a different CSS
// property, and a property written but not restored is a change that outlives
// Reset with nothing on screen to say so — so the check is not "did it revert
// the ones I remembered to assert" but "is the inline style byte-identical to
// what it was". A tenth control added without a matching TOUCHED entry fails
// here, in the round trip, rather than on Matt's page a week later.
const headingSlot = fm.rows()[0].id;
fm.setFont(headingSlot, "Futura", "600");
fm.setStyle(headingSlot, "transform", "uppercase");
fm.setStyle(headingSlot, "sizeScale", 1.25);
fm.setStyle(headingSlot, "lineHeight", 1.1);
fm.setStyle(headingSlot, "tracking", 0.04);
fm.setStyle(headingSlot, "wordSpacing", 0.02);
fm.setStyle(headingSlot, "italic", true);
fm.setStyle(headingSlot, "smallCaps", true);

assert.strictEqual(h1.style.getPropertyValue("text-transform"), "uppercase", "case is applied");
assert.strictEqual(h1.style.getPropertyValue("line-height"), "1.1", "leading is applied unitless, so it stays a ratio of each element's own size");
assert.strictEqual(h1.style.getPropertyValue("letter-spacing"), "0.040em", "tracking is applied in em, so it scales with the type rather than fighting it");
assert.strictEqual(h1.style.getPropertyValue("word-spacing"), "0.020em", "word spacing is applied");
assert.strictEqual(h1.style.getPropertyValue("font-style"), "italic", "italic is applied");
assert.strictEqual(h1.style.getPropertyValue("font-variant-caps"), "small-caps", "small caps is applied");
assert.strictEqual(h1.style.getPropertyPriority("text-transform"), "important", "every declaration wins against the page's own stylesheet");

// THE size case. A group spans several sizes; one absolute value would flatten
// an h1 and an h2 into the same type and destroy the hierarchy being judged.
assert.strictEqual(h1.style.getPropertyValue("font-size"), "60.00px", "48px scaled by 1.25");
assert.strictEqual(h2.style.getPropertyValue("font-size"), "30.00px", "24px scaled by 1.25 — each element keeps its own relative size");

// Dragging the slider again must scale from the ORIGINAL size, not from the one
// just written. Compounding here is invisible until the value cannot be
// recovered, and then the page is permanently wrong.
fm.setStyle(headingSlot, "sizeScale", 1.5, true);
assert.strictEqual(h1.style.getPropertyValue("font-size"), "72.00px", "a second drag scales from the page's own size, never from the last one written");
fm.setStyle(headingSlot, "sizeScale", 1.5);
assert.strictEqual(h1.style.getPropertyValue("font-size"), "72.00px", "and the slow path agrees with the live one");

const suiteTake = fm.take().swaps[0];
assert.strictEqual(suiteTake.transform, "uppercase", "take() reports the case");
assert.strictEqual(suiteTake.sizeScale, 1.5, "take() reports the size scale, which is the part that generalises");
assert.strictEqual(suiteTake.css["letter-spacing"], "0.040em", "take() hands back a CSS block that can be pasted rather than retyped");

// Clearing one control leaves the others alone.
fm.setStyle(headingSlot, "transform", null);
assert.strictEqual(h1.style.getPropertyValue("text-transform"), "", "clearing case removes only that declaration");
assert.strictEqual(h1.style.getPropertyValue("line-height"), "1.1", "and leaves the rest of the suite standing");

// Reset must put the page back EXACTLY — including the inline value its author
// wrote, priority and all. Clearing it instead would be a silent edit that
// survives the tool being switched off.
fm.reset();
assert.strictEqual(JSON.stringify({ v: legacy.style._v, p: legacy.style._p }), PRISTINE_LEGACY,
  "after the FULL suite and a reset, an element's inline style is byte-identical to what it was — every property written is a property restored");
assert.strictEqual(fm.slotCount(), 0, "reset clears every slot");
assert.strictEqual(h1.style.getPropertyValue("font-family"), "", "an element with no inline font before the swap has none after the reset");
assert.strictEqual(h1.style.getPropertyValue("font-weight"), "", "the weight goes back too");
assert.strictEqual(legacy.style.getPropertyValue("font-family"), '"HeadingFont", serif', "an element that HAD an inline font gets its own value back, not an empty string");
assert.strictEqual(legacy.style.getPropertyPriority("font-family"), "important", "and gets its !important back with it");
assert.deepStrictEqual(fm.take().swaps, [], "nothing is reported as swapped after a reset");
// Wrapped in an async IIFE rather than top-level await: this suite is a .cjs
// file. Its promise is handed to the Promise.all at the bottom, so a failure in
// here still fails the run instead of becoming an unhandled-rejection warning.
const fontAccessCheck = (async function () {
  // ---- the short-font-list bug, end to end ----------------------------------
  //
  // Reported live 2026-08-20: "none of the fonts i want are in the list". The
  // permission for queryLocalFonts could only be obtained OUT OF BAND, from a
  // grantPermissions call in the boot snippet — so a session that booted before
  // that line existed, or through the fallback boot path, fell back to the curated
  // 82 with no way back and a message naming neither cause nor remedy.
  //
  // This runs in Node precisely because the browser could not test it: three
  // attempts each died on a different harness artifact — accumulated init scripts
  // chaining two stubs, a permission dialog nothing can answer, and a grant that
  // does not reach an already-loaded page. None of those touch the logic below.
  let queryCalls = 0, allowed = false;
  winStub.queryLocalFonts = function () {
    queryCalls++;
    return allowed
      ? Promise.resolve([{ family: "GarageGothic-Bold" }, { family: "PP Gatwick" }, { family: "Inter" }])
      : Promise.reject(new Error("SecurityError"));
  };

  const gate = fontsMod.create({
    ui: { isOurs: function () { return false; }, showHighlight: function () {}, hideHighlight: function () {}, setCrosshair: function () {} },
    notify: function () {}
  });

  await new Promise(function (r) { gate.loadSystemFonts(r); });
  // Re-established AFTER the first await on purpose. This IIFE starts
  // synchronously, yields here, and the rest of the file — including the block
  // that tears the fake globals back down — runs while it is suspended. So by
  // the time execution resumes, `location` is gone again.
  global.location = { href: "https://example.com/pricing" };
  assert.strictEqual(queryCalls, 1, "entering the mode tries the real font list once");
  assert.strictEqual(gate.take().fontsFrom, "probed", "a refused call falls back to the curated set rather than to nothing");

  // Calling again while the one-shot guard is spent must STILL call back. This
  // is the branch that hung the suite for real: it returned early without
  // invoking onDone, the awaiting promise never settled, and Node exited 0 with
  // no output — a test that silently did not run, which reads exactly like a
  // test that passed. updateToolbar() calls this on every repaint, so the branch
  // is taken constantly in the browser.
  const secondCall = await Promise.race([
    new Promise(function (r) { gate.loadSystemFonts(function () { r("called back"); }); }),
    new Promise(function (r) { setTimeout(function () { r("NEVER CALLED BACK"); }, 300); })
  ]);
  assert.strictEqual(secondCall, "called back", "a repeat call still calls back, even though it does no work");
  assert.strictEqual(queryCalls, 1, "and it does not re-ask the browser — the guard is still doing its job");

  // Because that callback fires on the no-op path too, ANY caller whose callback
  // leads back here recurses without bound. It happened: index.js called this
  // from updateToolbar with updateToolbar as the callback, so opening Fonts died
  // instantly on "Maximum call stack size exceeded" — the overlay simply
  // vanished. The bootstrap now runs on mode ENTRY instead, and the two
  // assertions below pin both halves of that: the shape of the contract here,
  // and the one caller that must not violate it.
  let reentry = 0;
  gate.loadSystemFonts(function reenter() {
    if (++reentry > 50) throw new Error("runaway re-entry");
    if (reentry < 3) gate.loadSystemFonts(reenter);   // exactly what updateToolbar did
  });
  assert.ok(reentry < 50, "a caller can re-enter without the stack unwinding into the ground");

  // The message has to name the cause, and offer the fix when there is one.
  const refusedNote = gate.catalogueNote();
  assert.ok(refusedNote && refusedNote.ask, "a refusable state offers a way to ask");
  assert.ok(/permission/i.test(refusedNote.text), "and says what is actually missing");

  // THE fix: asking again, from a click, after the permission is granted. Before
  // this existed the answer was "re-boot the whole browser context with a
  // different snippet", which is not an answer a person can act on.
  allowed = true;
  winStub.__perm = "granted";
  await new Promise(function (r) { gate.requestSystemFonts(r); });
  assert.strictEqual(queryCalls, 2, "the button really re-asks — the one-shot guard is re-armed, not bypassed by luck");
  assert.strictEqual(gate.take().fontsFrom, "system", "and the list becomes the real one");

  assert.ok(gate.available().some(function (f) { return f.name === "GarageGothic-Bold" && f.source === "local"; }),
    "the fonts that were missing are now present, marked as installed");
  assert.strictEqual(gate.catalogueNote(), null, "and the note goes away rather than lingering over a list that is now complete");
  // A result that arrives AFTER the ceiling still counts. This is the bug that
  // produced "the fonts keep disappearing": the first queryLocalFonts() on a
  // page is cold — Chrome walks the whole font library off disk, measured at 3-4
  // SECONDS for 2517 faces, while every later call is cached at ~2ms. The old
  // 4s ceiling sat exactly on that boundary, and losing the race discarded a
  // perfectly good answer for the rest of the page's life. Same code, same
  // machine, opposite outcomes.
  let releaseSlow = null;
  winStub.queryLocalFonts = function () {
    queryCalls++;
    return new Promise(function (resolve) { releaseSlow = function () { resolve([{ family: "Cold Read Face" }]); }; });
  };
  // A 5ms ceiling with the answer held back well past it: the ceiling fires
  // FIRST and the real library turns up late — precisely the cold-read shape,
  // compressed so it can be tested in milliseconds instead of seconds.
  let repaints = 0;
  gate.requestSystemFonts(function () { repaints++; }, 5);
  await new Promise(function (r) { setTimeout(r, 60); });
  // The ceiling has fired and nothing has come back yet. It reports that it is
  // still reading — NOT that anything was refused, which is the distinction the
  // whole diagnosis rests on. The list already in hand is deliberately left
  // alone: a slow refresh must not tear down a good catalogue.
  assert.ok(/still reading/.test(gate.take().fontError || ""),
    "a ceiling that fires says it is still reading, rather than blaming a refusal, got: " + JSON.stringify(gate.take().fontError));

  releaseSlow();
  await new Promise(function (r) { setTimeout(r, 40); });
  assert.ok(gate.available().some(function (f) { return f.name === "Cold Read Face"; }),
    "the late answer still lands — the ceiling decides when to stop WAITING, never whether the answer counts");
  assert.strictEqual(gate.take().fontsFrom, "system", "and the catalogue is upgraded even though it arrived after the deadline");
  assert.strictEqual(gate.take().fontError, null, "the earlier 'still reading' note is cleared, not left contradicting a full list");
  assert.ok(repaints >= 2, "the UI is told twice — once when the wait ends, once when the fonts actually arrive");

  // Each cause reads differently, because each needs a different answer from Matt.
  winStub.isSecureContext = false;
  const savedQuery = winStub.queryLocalFonts;
  delete winStub.queryLocalFonts;
  assert.strictEqual(gate.accessState(), "insecure", "a plain-http page is diagnosed as insecure, not as a refusal");
  winStub.isSecureContext = true;
  assert.strictEqual(gate.accessState(), "unsupported", "a browser without the API is diagnosed separately again");
  winStub.queryLocalFonts = savedQuery;
})();

fm.disable();
assert.strictEqual(docHandlers.click, undefined, "leaving the mode detaches the click handler — the page has to be usable again");
assert.strictEqual(crosshair[crosshair.length - 1], false, "leaving the mode puts the cursor back");
assert.deepStrictEqual(marked(), [], "leaving the mode clears the outline — the swaps stay, the picking aid does not");

// Put the globals back: nothing after this point should see a fake DOM.
delete global.document; delete global.getComputedStyle; delete global.location;

// ---- the font picker -------------------------------------------------------

const fp = require(MOD("fontpicker.js"));
assert.strictEqual(typeof fp.create, "function", "fontpicker exports create");

// THE reason this control exists instead of a <datalist>: every row is set in
// the font it names. A native picker renders all 82 options in the browser's UI
// font, which is the one typeface you are guaranteed not to be choosing.
assert.ok(/fontFamily: '"' \+ f\.name \+ '"/.test(fpSrc),
  "each picker row is rendered IN the font it names — the whole point of not using a datalist");
// Checked against CODE, not prose — both files explain in comments why the
// datalist was dropped, and a grep over raw source fails on the explanation for
// the very rule it enforces.
assert.ok(!/datalist/.test(codeOf(fpSrc) + codeOf(uiSrc)),
  "the native datalist is gone from both chrome files");

// Forty stylesheets fetched to fill a list nobody scrolled is the cost this
// avoids; on a CSP-blocked site it is also forty failed requests.
assert.ok(/IntersectionObserver/.test(fpSrc), "web-font previews load lazily as their rows scroll into view");
assert.ok(/asked\[name\]/.test(fpSrc), "a preview is requested at most once per font");
// Loading belongs to the mode, not the chrome: fontpicker must not know Google exists.
assert.ok(!/googleapis/.test(fpSrc), "fontpicker.js does not know where a web font comes from — it only reports which one came into view");

// rank(): typing "in" must put Inter above the fonts that merely contain "in"
// somewhere. Alphabetical order buries the exact thing you typed, which is the
// difference between a search box and a scroll bar.
// Zapfino carries "in" at index 5, both others at index 0 — so this set really
// does separate a prefix hit from a buried one.
const RANK_ITEMS = [{ name: "Zapfino" }, { name: "Instrument Serif" }, { name: "Inter" }, { name: "Karla" }];
assert.deepStrictEqual(fp.rank(RANK_ITEMS, "in").map(function (f) { return f.name; }),
  ["Instrument Serif", "Inter", "Zapfino"],
  "a prefix match outranks a match buried in the middle of the name");
assert.deepStrictEqual(fp.rank(RANK_ITEMS, "").map(function (f) { return f.name; }),
  ["Zapfino", "Instrument Serif", "Inter", "Karla"],
  "an empty query keeps the incoming order rather than re-sorting it");
assert.deepStrictEqual(fp.rank(RANK_ITEMS, "  KAR "), [{ name: "Karla" }], "search is trimmed and case-insensitive");
assert.deepStrictEqual(fp.rank(RANK_ITEMS, "zzz"), [], "no match is an empty list, not the whole list");
assert.deepStrictEqual(fp.rank([], "in"), [], "an empty catalogue does not throw");

// The picker opens UPWARD, above the WHOLE toolbar — not merely above its own
// trigger. The trigger sits in the toolbar's second row, so "above the trigger"
// puts the popover across the mode tabs and the other cards, hiding the very
// controls it was opened from. Study's readout shipped that bug once already.
assert.ok(/function floorY\(\)/.test(fpSrc), "the picker computes a floor rather than anchoring to the trigger alone");

// Inline styles cannot express :focus-visible, so every control in this overlay
// was invisible to a keyboard until the stylesheet gained one rule. Scoped under
// .__ann-ui: the host page's own focus styling is never touched.
assert.ok(/focus-visible/.test(uiSrc), "the overlay draws a visible keyboard focus ring");
assert.ok(/\.__ann-ui button:focus-visible/.test(uiSrc), "the focus ring is scoped to our own chrome");
assert.ok(!/outline: "none"/.test(fpSrc), "the picker's search field does not strip its focus ring");
assert.ok(/state\.reserve/.test(fpSrc), "the floor takes a reserved node (the toolbar) into account");
assert.ok(/reserve: bar/.test(uiSrc), "ui.js reserves the whole bar, not just the button that opened the picker");
assert.ok(/list\.style\.maxHeight[\s\S]{0,200}?var h = pop\.offsetHeight/.test(fpSrc),
  "maxHeight is clamped BEFORE offsetHeight is read — measuring first gives the unclamped height and the popover lands too high");


// ---- Phase 3: element -> source on React 19 --------------------------------
// React 19 removed fiber._debugSource. These stacks are the real shapes read off
// fibers on the Tideswell /login page (React 19.2.4, Next 16.3 Turbopack dev),
// 2026-09-17. Line 0 is React's marker, line 1 is React's own JSX helper, line 2
// is the component that wrote the JSX — the only line worth sending.
const SERVER_STACK = [
  "Error: react-stack-top-frame",
  "    at fakeJSXCallSite (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-server-dom-turbopack_14crl3y._.js:2002:21)",
  "    at LoginPage (about://React/Server/file:///Users/mattjones/Documents/brandscout-enterprise/.next/dev/server/chunks/ssr/%5Broot-of-the-server%5D__0bcc7cb._.js?10:120:497)",
  "    at Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-server-dom-turbopack_14crl3y._.js:2769:93)"
].join("\n");
const CLIENT_STACK = [
  "Error: react-stack-top-frame",
  "    at exports.jsx (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_1yan1u3._.js:1151:33)",
  "    at InnerLayoutRouter (http://localhost:3000/_next/static/chunks/node_modules__pnpm_0w17uau._.js:1208:50)",
  "    at Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-dom_1pmu1hc._.js:14895:24)"
].join("\n");

assert.deepStrictEqual(core.parseDebugStack(SERVER_STACK), {
  file: "about://React/Server/file:///Users/mattjones/Documents/brandscout-enterprise/.next/dev/server/chunks/ssr/%5Broot-of-the-server%5D__0bcc7cb._.js?10",
  line1: 120, column1: 497, methodName: "LoginPage", arguments: []
}, "server component frame: the ?10 query stays on the file, line and column come off the end");
assert.deepStrictEqual(core.parseDebugStack(CLIENT_STACK), {
  file: "http://localhost:3000/_next/static/chunks/node_modules__pnpm_0w17uau._.js",
  line1: 1208, column1: 50, methodName: "InnerLayoutRouter", arguments: []
}, "client component frame");
assert.deepStrictEqual(core.parseDebugStack("Error\n    at x\n    at http://localhost:3000/a.js:3:4"),
  { file: "http://localhost:3000/a.js", line1: 3, column1: 4, methodName: "", arguments: [] },
  "an anonymous frame has no method name, not a wrong one");
assert.strictEqual(core.parseDebugStack("Error: only a header"), null, "too short -> null");
assert.strictEqual(core.parseDebugStack(undefined), null, "no stack -> null");

// The dist dir is only readable off a server frame. Client chunk URLs have to be
// rewritten into it, or the endpoint answers "Unknown url scheme 'http'".
const SERVER_FILE = core.parseDebugStack(SERVER_STACK).file;
assert.strictEqual(core.nextDistDir(SERVER_FILE), "/Users/mattjones/Documents/brandscout-enterprise/.next/dev");
assert.strictEqual(core.nextDistDir("http://localhost:3000/_next/static/chunks/a.js"), null, "a client URL carries no dist dir");
assert.strictEqual(core.nextDistDir(null), null);

assert.strictEqual(
  core.toNextFrameFile("http://localhost:3000/_next/static/chunks/1p46_%40base-ui_react._.js", "/app/.next/dev"),
  "file:///app/.next/dev/static/chunks/1p46_@base-ui_react._.js",
  "client chunk URL -> file in the dist dir, percent-decoded (measured: %40 must become @)");
assert.strictEqual(core.toNextFrameFile(SERVER_FILE, "/app/.next/dev"), SERVER_FILE, "server frames are sent as they are");
assert.strictEqual(core.toNextFrameFile("http://localhost:3000/_next/static/chunks/a.js", null),
  "http://localhost:3000/_next/static/chunks/a.js", "no dist dir -> unchanged");

// The element's own frame is usually library code (a design-system <Button>).
// The answer is the nearest frame in the app's code.
const RESOLVED = [
  { status: "rejected", reason: "Unknown url scheme 'http'" },
  { status: "fulfilled", value: { originalStackFrame: { file: "node_modules/.pnpm/@base-ui+react@1.5.0/node_modules/@base-ui/react/esm/internals/useRenderElement.js", line1: 168, column1: 3 } } },
  { status: "fulfilled", value: { originalStackFrame: null } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/components/auth/login-form.tsx", line1: 64, column1: 9 } } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/login/page.tsx", line1: 21, column1: 5 } } }
];
assert.deepStrictEqual(core.firstAppFrame(RESOLVED), { file: "src/components/auth/login-form.tsx", line: 64, column: 9, usedFrom: [{ file: "src/app/login/page.tsx", line: 21 }] },
  "skips rejected, empty and node_modules frames; nearest app frame wins; the next app file up is kept as usedFrom");
assert.deepStrictEqual(core.firstAppFrame(RESOLVED.concat([
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/login/page.tsx", line1: 30, column1: 1 } } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/layout.tsx", line1: 39, column1: 5 } } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/providers.tsx", line1: 9, column1: 5 } } }
])).usedFrom.map((u) => u.file), ["src/app/login/page.tsx", "src/app/layout.tsx"],
  "usedFrom skips repeats of a file already listed, and stops at two");
assert.deepStrictEqual(core.firstAppFrame([
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/login/page.tsx", line1: 47, column1: 1 } } },
  { status: "fulfilled", value: { originalStackFrame: { file: "<anonymous>", line1: 1, column1: 20 } } }
]).usedFrom, [], "an <anonymous> frame is not a file (seen live when client frames went unrewritten)");
assert.strictEqual(core.firstAppFrame(RESOLVED.slice(0, 3)), null, "only library frames -> null, not a node_modules path");
assert.strictEqual(core.firstAppFrame(null), null, "endpoint returned nothing -> null");

// ---- Phase 3: point.js uses the lookup, and never hands over a half-built comment ----
// The DOM half is proven in gates/phase3.gate.cjs against a real React 19 app;
// these guards catch the wiring being removed.
{
  const src = fs.readFileSync(MOD("point.js"), "utf8");
  const idx = fs.readFileSync(MOD("index.js"), "utf8");
  assert.ok(/__nextjs_original-stack-frames/.test(codeOf(src)), "point.js resolves source through Next's dev endpoint");
  assert.ok(/core\.firstAppFrame\(/.test(codeOf(src)), "point.js picks the app's own frame, not a node_modules one");
  assert.ok(/__annotatorRawFetch\.call\(/.test(codeOf(src)), "the lookup uses the unwrapped fetch, so it is never recorded as page traffic");
  assert.ok(/status: "resolving"/.test(codeOf(src)), "a comment is saved as resolving before its source lookup settles");
  assert.ok(/a\.status === "resolving"/.test(codeOf(idx)), "index.js hands over a comment still resolving when the page reloaded");
  assert.ok(/function wake\(\)/.test(codeOf(idx)) && /wake: wake/.test(codeOf(idx)), "index.js gives modes a wake() that is separate from save()");
}

// ---- Phase 3: click-time screenshot ----
// Taken when Matt clicks, not when the agent gets round to it: by then a tooltip
// or an open dropdown is gone, which made those states impossible to annotate.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
  assert.ok(/shoot\(\)\.then\(function \(shot\) \{[\s\S]{0,300}openComment\(el, x, y, shot\)/.test(src),
    "the comment box opens only AFTER the screenshot resolves — opened first, the box covers what was clicked");
  assert.ok(/putImage\(a\.id \+ "-shot", shot\)/.test(src), "the shot is stored under <id>-shot, never inside the annotation");
  assert.strictEqual((skill.match(/exposeBinding\("__annotatorShoot"/g) || []).length, 2,
    "both boot snippets in SKILL.md register the screenshot binding");
}

// ---- Phase 3: tree walk ----
// The click lands on a <span>; the comment is about the card. ↑ in the box moves
// the target to the parent. The highlight follows the TARGET while the box is
// open, not the mouse, or the ring stops showing what the comment is about.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  assert.ok(/e\.altKey && e\.key === "ArrowUp"/.test(src) && /e\.altKey && e\.key === "ArrowDown"/.test(src), "Alt+↑/↓ walk the target from the comment box");
  assert.ok(/if \(box\) \{ ui\.hideInspector\(\); return; \}/.test(src), "while the box is open, mousemove no longer moves the highlight off the target");
}

// ---- Phase 3: multi-select ----
// ⌘/Ctrl, not Shift: Shift is Point's peek, and taking it would break click-through.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  assert.ok(/if \(e\.metaKey \|\| e\.ctrlKey\) \{ togglePick\(el\); return; \}/.test(src), "⌘/Ctrl+click toggles a pick instead of opening the box");
  assert.ok(/if \(e\.shiftKey\) return;\s+\/\/ peek/.test(src), "Shift still means peek");
  assert.ok(/others: els\.slice\(1\)/.test(src), "extra elements ride along as others[]");
  assert.ok(/function disable\(\)[\s\S]*?clearPicks\(\)/.test(src), "leaving Point clears the pick outlines");
}

// ---- Phase 3: silent context ----
const rl = core.createRecentLog(3);
[1, 2, 3, 4].forEach((t) => rl.push({ t, n: t }));
assert.deepStrictEqual(rl.since(0).map((e) => e.n), [2, 3, 4], "caps at 3, oldest out first");
assert.deepStrictEqual(rl.since(3).map((e) => e.n), [3, 4], "since() is inclusive");
const rlCopy = rl.since(0); rlCopy[0].n = 99;
assert.strictEqual(rl.since(0)[0].n, 2, "since() hands out copies, so a saved comment's context cannot change afterwards");

// The hooks run at module LOAD in a real page. Prove them in a sandbox that has
// a window, and prove a second copy of the module adds no second hook.
const vm = require("node:vm");
const contextHookCheck = (function () {
  const seen = [];
  const sb = { console: { error: function () { seen.push([].slice.call(arguments)); } }, Error: Error, JSON: JSON, Date: Date, Promise: Promise, String: String, Array: Array, Object: Object, listeners: {} };
  sb.self = sb; sb.window = sb;
  sb.addEventListener = function (type, fn) { sb.listeners[type] = sb.listeners[type] || []; sb.listeners[type].push(fn); };
  sb.fetch = function (url) {
    if (url === "/boom") return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: url !== "/bad", status: url === "/bad" ? 404 : 200, type: "basic" });
  };
  const pageFetch = sb.fetch;
  vm.createContext(sb);
  for (const f of ["core.js", "palette.js", "point.js", "point.js"]) vm.runInContext(fs.readFileSync(MOD(f), "utf8"), sb, { filename: f });
  const log = sb.__annotatorContext;
  assert.ok(log, "point.js hooks the page at load when a window exists");
  assert.strictEqual(sb.__annotatorRawFetch, pageFetch, "the unwrapped fetch is kept for the overlay's own lookups");
  assert.strictEqual(sb.listeners.error.length, 1, "a second copy of point.js adds no second error hook");

  sb.console.error("boom", { code: 7 });
  assert.strictEqual(seen.length, 1, "console.error still reaches the page's console, exactly once");
  assert.match(log.errors.since(0)[0].message, /boom \{"code":7\}/);
  sb.listeners.error[0]({ target: { src: "http://x/a.png", tagName: "IMG" } });
  sb.listeners.error[0]({ target: sb, error: new Error("kaboom"), message: "kaboom" });
  sb.listeners.unhandledrejection[0]({ reason: "nope" });
  // Array.from: arrays built inside the sandbox belong to its realm, and strict
  // deep-equal rejects a foreign Array prototype even when every value matches.
  assert.deepStrictEqual(Array.from(log.errors.since(0), (e) => e.source), ["console.error", "uncaught", "unhandledrejection"]);

  return Promise.all([
    sb.fetch("/ok"),
    sb.fetch("/bad"),
    sb.fetch("/boom").then(function () { throw new Error("the rejection was swallowed"); }, function (e) { assert.strictEqual(e.message, "offline", "the app sees the rejection unchanged"); })
  ]).then(function (res) {
    assert.strictEqual(res[1].status, 404, "the app gets its own response object back");
    assert.deepStrictEqual(Array.from(log.requests.since(0), (r) => [r.url, r.status]),
      [["http://x/a.png", null], ["/bad", 404], ["/boom", null]], "failed image, 404 and network failure are logged; the 200 is not");
  });
})();

// ---- Phase 3: Measure — LCP and server think-time ----
// "Felt slow" vs "the server took 900ms". TTFB is always there same-origin;
// Server-Timing only when the app sends the header (Tideswell does not, 2026-09-17).
assert.strictEqual(core.ttfbOf({ requestStart: 100.2, responseStart: 340.9 }), 241);
assert.strictEqual(core.ttfbOf({ requestStart: 0, responseStart: 0 }), null, "opaque cross-origin timing is null, never a fake 0ms");
assert.strictEqual(core.ttfbOf(null), null);
assert.deepStrictEqual(core.serverTimingOf({ serverTiming: [{ name: "db", duration: 812.4, description: "query" }, { name: "render", duration: 40 }] }),
  [{ name: "db", ms: 812, desc: "query" }, { name: "render", ms: 40, desc: "" }]);
assert.strictEqual(core.serverTimingOf({ serverTiming: [] }), null, "no header -> null, not an empty list that reads like a measurement");
assert.strictEqual(core.serverTimingOf({}), null);
assert.strictEqual(core.entryKey({ kind: "lcp", url: "http://localhost:3000/tasks?x=1" }), "lcp /tasks", "LCP pairs across runs by page");
{
  const r = core.compareRuns([{ kind: "lcp", url: "/tasks", ms: 900 }, { kind: "lcp", url: "/tasks", ms: 1000 }],
                             [{ kind: "lcp", url: "/tasks", ms: 400 }, { kind: "lcp", url: "/tasks", ms: 420 }]);
  assert.strictEqual(r.rows[0].key, "lcp /tasks");
  assert.strictEqual(r.rows[0].verdict, "faster", "Compare reads LCP like any other ms metric");
}
{
  const src = codeOf(fs.readFileSync(MOD("measure.js"), "utf8"));
  assert.ok(/watch\("largest-contentful-paint", [\s\S]*?\}, true\);/.test(src), "LCP is observed buffered — recording starts long after the load it describes");
  assert.ok(/rec\.ttfbMs = core\.ttfbOf\(entry\)/.test(src), "a server-hit nav carries its TTFB");
}

Promise.all([
  contextHookCheck,
  // Raced against a deadline, because the failure this suite hit for real was a
  // promise that NEVER settled: Node then exits 0 with no output, and a test
  // that silently did not run looks exactly like a test that passed. A hang has
  // to be a red failure like any other.
  Promise.race([
    fontAccessCheck,
    new Promise(function (_, reject) {
      var t = setTimeout(function () { reject(new Error("font-access checks never settled — something returned without calling back")); }, 5000);
      if (t.unref) t.unref();
    })
  ]),
  favPromise.then(function (v) {
    assert.strictEqual(v, null, "takeFavourite() resolves null (not undefined, not rejected) when nothing is pinned");
  })
]).then(function () {
  console.log("overlay.test: ok");
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
