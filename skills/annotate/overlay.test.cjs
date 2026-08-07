// Self-check for the one piece of tricky logic in overlay.js: buildSelector.
// Pure helpers now live in overlay/core.js and are required directly; overlay.js
// itself is now just the loader (Task 6) — its source is still read (never
// executed here) for the file-input regression guard and the loader's own checks.
// Run: node .claude/skills/annotate/overlay.test.cjs
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
for (const api of ["__annotatorDrain", "__annotatorWait", "__annotatorPerfTake", "__annotatorReveal"]) {
  assert.ok(indexSrc.indexOf("window." + api) !== -1, "index.js still exposes " + api);
}

// The long-poll is woken directly by save(); a poll-interval-bound version
// would make every comment feel laggy.
assert.ok(/waiter/.test(indexSrc), "index.js keeps the one-shot waiter");
assert.ok(/25000/.test(indexSrc), "index.js keeps the 25s long-poll ceiling");

// The idempotent re-inject guard.
assert.ok(/if\s*\(\s*window\.__annotator\s*\)\s*return/.test(indexSrc), "index.js keeps the re-inject guard");

// The mode cycle must remain off -> on -> measure -> off. Guarded on the source since
// a third mode silently rewritten as "off" -> "measure" would drop straight back to off.
assert.ok(/"off"\s*:\s*"measure"/.test(indexSrc) || /"measure"\s*:\s*"off"/.test(indexSrc), "toggle must cycle through measure");

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
const order = ["core.js", "palette.js", "ui.js", "point.js", "measure.js", "index.js"];
let at = -1;
for (const f of order) {
  const i = loaderSrc.indexOf(f);
  assert.ok(i > at, "loader lists " + f + " in dependency order");
  at = i;
}

console.log("overlay.test: ok");
