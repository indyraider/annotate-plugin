// Annotate overlay — study mode's motion detection. Split out of study.js
// (already 371 lines before this) because reading animations is a separate
// concern from reading styles. Four tiers, honestly graded: a browser
// standard (complete), a library reachable via a global (near-complete),
// inference from network + a live sample (detection without detail), and
// source-map availability (the jackpot, when it exists). Every finding is
// tagged with the tier it came from — implying uniform confidence across
// "the browser told me" and "I inferred it from a frame counter" would be
// the dishonest version of this feature. Read-only: nothing here writes to
// an existing page node; the one global it patches (requestAnimationFrame)
// is always restored before this module ever hands back a result.
;(function (root, factory) {
  var core = (typeof module !== "undefined" && module.exports) ? require("./core.js") : (root.__annotatorMods && root.__annotatorMods.core);
  var api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.studyMotion = api; }
})(typeof self !== "undefined" ? self : this, function (core) {
  if (!core) throw new Error("annotate: study-motion.js requires core.js to load first");
  var buildSelector = core.buildSelector;

  // A function call that might throw on somebody else's page must cost us
  // one field, never the whole readout.
  function probe(fn) { try { return fn(); } catch (e) { return undefined; } }

  // ---- Tier 1: document.getAnimations()/el.getAnimations() -----------------
  // Baseline since 2020, and covers every CSS transition, CSS animation and
  // Web Animations API animation — this half of the picture is solved, not
  // approximated.
  function readTier1(el) {
    var animations = [];
    try {
      var own = (el && typeof el.getAnimations === "function") ? el.getAnimations() : [];
      var all = own.slice();
      var pageAnims = (typeof document !== "undefined" && typeof document.getAnimations === "function") ? document.getAnimations() : [];
      for (var i = 0; i < pageAnims.length; i++) {
        var a = pageAnims[i];
        if (all.indexOf(a) === -1 && a.effect && a.effect.target === el) all.push(a);
      }
      for (var j = 0; j < all.length; j++) {
        var anim = all[j], effect = anim.effect;
        var timing = probe(function () { return effect && effect.getTiming ? effect.getTiming() : null; });
        var keyframes = probe(function () { return effect && effect.getKeyframes ? effect.getKeyframes() : null; });
        animations.push({
          type: (anim.constructor && anim.constructor.name) || "Animation",
          playState: anim.playState,
          target: effect && effect.target ? buildSelector(effect.target) : null,
          timing: timing ? {
            duration: timing.duration, delay: timing.delay, easing: timing.easing,
            iterations: timing.iterations, direction: timing.direction, fill: timing.fill
          } : null,
          keyframes: keyframes || null
        });
      }
    } catch (e) { /* getAnimations threw — report what we have, never crash Study */ }

    // @keyframes bodies from document.styleSheets — same per-sheet try/catch
    // as study.js's stylesheet walk: a cross-origin sheet (any CDN font) throws
    // on .cssRules, which is normal and must cost one sheet, not the readout.
    var keyframeRules = [];
    try {
      var sheets = document.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        var rules;
        try { rules = sheets[s].cssRules; } catch (e2) { continue; }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          var text = null;
          try { text = rules[r].cssText; } catch (e3) { continue; }
          if (text && /^@(-webkit-)?keyframes\s/i.test(text)) {
            keyframeRules.push({ name: rules[r].name || null, cssText: text });
          }
        }
      }
    } catch (e4) { /* whole styleSheets list unavailable — exceptional, not fatal */ }

    return { animations: animations, keyframeRules: keyframeRules, found: animations.length > 0 || keyframeRules.length > 0 };
  }

  // ---- Tier 2: a library reachable via a global -----------------------------
  function probeGsap() {
    var out = { present: false };
    try {
      if (typeof window.gsap === "undefined") return out;
      out.present = true;
      out.version = window.gsap.version || null;
      var tweens = [];
      try {
        var gt = window.gsap.globalTimeline;
        var kids = (gt && typeof gt.getChildren === "function") ? gt.getChildren() : [];
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          // .targets()/.vars were NOT confirmed against GSAP's docs at design
          // time — probed with typeof, never assumed, or a version mismatch
          // on somebody else's site throws here.
          tweens.push({
            type: (k.constructor && k.constructor.name) || "tween",
            targets: (typeof k.targets === "function") ? probe(function () { return k.targets(); }) : undefined,
            vars: (k && typeof k.vars === "object") ? k.vars : undefined
          });
        }
      } catch (e) {}
      out.tweenCount = tweens.length;
      out.tweens = tweens.slice(0, 50); // cap — one page's timeline must not blow the readout
      var st = window.ScrollTrigger || window.gsap.ScrollTrigger;
      if (st && typeof st.getAll === "function") {
        try {
          out.scrollTriggers = st.getAll().map(function (t) {
            return {
              trigger: t.trigger ? buildSelector(t.trigger) : null,
              start: t.start, end: t.end, progress: t.progress,
              direction: t.direction, isActive: t.isActive
            };
          });
        } catch (e2) { out.scrollTriggers = []; }
      }
    } catch (e3) { /* absence, not an error */ }
    return out;
  }

  function probeLottie() {
    var out = { present: false };
    try {
      var lib = window.lottie || window.bodymovin;
      if (!lib) return out;
      out.present = true;
      // The whole animation IS the JSON file — reachable via each instance's
      // .path when loaded with {path: ...}, the common case.
      var anims = probe(function () { return (typeof lib.getRegisteredAnimations === "function") ? lib.getRegisteredAnimations() : null; });
      var urls = [];
      if (anims) for (var i = 0; i < anims.length; i++) { if (anims[i] && anims[i].path) urls.push(anims[i].path); }
      out.animationCount = anims ? anims.length : null;
      out.jsonUrls = urls;
    } catch (e) {}
    return out;
  }

  function probeThree() {
    var out = { present: false };
    try {
      if (typeof window.THREE === "undefined") return out;
      out.present = true;
      out.version = window.THREE.REVISION || null;
      // ponytail: counting <canvas> elements only, not calling .getContext() —
      // getContext() on a canvas with no context yet PERMANENTLY binds it to
      // that context type, which is a real mutation of host page state. Read
      // -only wins over a more precise "confirmed WebGL" count.
      out.canvasCount = (typeof document !== "undefined") ? document.querySelectorAll("canvas").length : 0;
    } catch (e) {}
    return out;
  }

  function probeGlobal(names) {
    for (var i = 0; i < names.length; i++) {
      try { if (typeof window[names[i]] !== "undefined") return { present: true, globalName: names[i] }; } catch (e) {}
    }
    return { present: false };
  }

  function readTier2() {
    return {
      gsap: probeGsap(),
      lottie: probeLottie(),
      three: probeThree(),
      anime: probeGlobal(["anime"]),
      motion: probeGlobal(["Motion", "motion"]),
      lenis: probeGlobal(["Lenis"]),
      swiper: probeGlobal(["Swiper"]),
      aos: probeGlobal(["AOS"]),
      locomotiveScroll: probeGlobal(["LocomotiveScroll"])
    };
  }
  function anyTier2Present(t2) {
    for (var k in t2) { if (Object.prototype.hasOwnProperty.call(t2, k) && t2[k] && t2[k].present) return true; }
    return false;
  }

  // ---- Tier 3: detection without detail -------------------------------------
  // Bundled ES modules (and Framer Motion, which never had a global) expose
  // nothing to probe. Two signals instead: a network fingerprint (instant),
  // and proof that something JS-driven is writing to this element (a ~1s
  // sample of the frame loop correlated with style mutations).
  var FINGERPRINT_RE = /gsap|three|lottie|framer-motion|motion|anime|lenis|locomotive/i;
  function fingerprintFromNetwork() {
    var matches = [];
    try {
      var entries = performance.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) { if (FINGERPRINT_RE.test(entries[i].name)) matches.push(entries[i].name); }
    } catch (e) {}
    return matches;
  }

  var SAMPLE_MS = 1000;
  // Module-level, not per-create(): the singleton must be shared across every
  // instance so a second sample anywhere always supersedes the first, rather
  // than each create() call getting its own blind spot.
  var activeSample = null;

  // Every exit path — normal completion, superseded by a new sample, no rAF/
  // MutationObserver support, or the caller's callback throwing — restores
  // requestAnimationFrame and disconnects the observer BEFORE this function
  // hands control back. Study is read-only; a leaked patch would slow the
  // very page being measured.
  function sampleElementMotion(el, durationMs, done) {
    if (activeSample) activeSample.cancel(); // idempotent: never two patches installed at once

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function" || typeof MutationObserver === "undefined" || !el) {
      done({ sampledMs: 0, framesPerSec: 0, styleWritesPerSec: 0, jsDriven: false, unavailable: true });
      return { cancel: function () {} };
    }

    var origRaf = window.requestAnimationFrame;
    var frameCount = 0, writeCount = 0, finished = false, observer = null, timer = null;
    var t0 = performance.now();

    window.requestAnimationFrame = function (cb) { frameCount++; return origRaf.apply(this, arguments); };

    try {
      observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) { if (mutations[i].attributeName === "style") writeCount++; }
      });
      observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    } catch (e) { observer = null; }

    function finish(cancelled) {
      if (finished) return;
      finished = true;
      window.requestAnimationFrame = origRaf;
      if (observer) { try { observer.disconnect(); } catch (e2) {} }
      clearTimeout(timer);
      if (activeSample === handle) activeSample = null;
      var result;
      if (cancelled) {
        result = { sampledMs: Math.round(performance.now() - t0), framesPerSec: 0, styleWritesPerSec: 0, jsDriven: false, cancelled: true };
      } else {
        var elapsed = performance.now() - t0;
        result = {
          sampledMs: Math.round(elapsed),
          framesPerSec: elapsed > 0 ? Math.round(frameCount / (elapsed / 1000)) : 0,
          styleWritesPerSec: elapsed > 0 ? Math.round(writeCount / (elapsed / 1000)) : 0
        };
        result.jsDriven = result.styleWritesPerSec > 0;
      }
      try { done(result); } catch (e3) { /* cleanup above already ran; a bad callback must not leak the patch */ }
    }

    timer = setTimeout(function () { finish(false); }, durationMs);
    var handle = { cancel: function () { finish(true); } };
    activeSample = handle;
    return handle;
  }

  // ---- Tier 4: source maps ---------------------------------------------------
  // Report the map URL only — fetching and parsing it is later work, and
  // promising that here would overstate what ships.
  function probeSourceMaps(scriptUrls, done) {
    var CAP = 8; // bounded — this is a courtesy probe, not a crawl of the site's whole bundle
    var targets = scriptUrls.slice(0, CAP);
    if (!targets.length || typeof fetch !== "function") { done([]); return; }
    var results = [], remaining = targets.length;
    for (var i = 0; i < targets.length; i++) {
      (function (url) {
        fetch(url).then(function (res) { return res.text(); }).then(function (text) {
          var m = /\/\/#\s*sourceMappingURL=(\S+)/.exec(text);
          if (m) results.push({ scriptUrl: url, sourceMapUrl: m[1] });
        }).catch(function () { /* CORS or network failure — absence, not error */ })
          .then(function () { if (--remaining === 0) done(results); });
      })(targets[i]);
    }
  }

  // Which tiers actually yielded data, graded honestly rather than uniformly —
  // a caller must never mistake a tier-3 inference for a tier-1 fact.
  function summarizeConfidence(r) {
    var tiers = [];
    if (r.tier1.found) tiers.push("tier1: browser API (complete)");
    if (anyTier2Present(r.tier2)) tiers.push("tier2: library global (near-complete)");
    if ((r.tier3.fingerprint && r.tier3.fingerprint.length) || (r.tier3.proof && r.tier3.proof.jsDriven)) tiers.push("tier3: inferred (detection without detail)");
    if (r.tier4.sourceMaps && r.tier4.sourceMaps.length) tiers.push("tier4: source map found (jackpot)");
    return { tiersWithData: tiers, summary: tiers.length ? tiers.join("; ") : "no motion detected on this element" };
  }

  // readMotion(el) returns synchronously with everything that can be known
  // instantly (tiers 1, 2, and tier 3's network fingerprint), and kicks off
  // tier 3's live sample and tier 4's source-map probe in the background —
  // both are inherently time-based/async. onUpdate (optional) is called each
  // time one of those finishes with the same result object, enriched in place.
  function readMotion(el, onUpdate) {
    var networkFingerprint = fingerprintFromNetwork();
    var result = {
      tier1: readTier1(el),
      tier2: readTier2(),
      tier3: { fingerprint: networkFingerprint, proof: { status: "sampling" } },
      tier4: { candidateScripts: networkFingerprint, sourceMaps: [], status: "checking" },
      confidence: null
    };
    result.confidence = summarizeConfidence(result);

    sampleElementMotion(el, SAMPLE_MS, function (proof) {
      proof.status = proof.cancelled ? "cancelled" : "done";
      result.tier3.proof = proof;
      result.confidence = summarizeConfidence(result);
      if (typeof onUpdate === "function") onUpdate(result);
    });

    probeSourceMaps(networkFingerprint, function (maps) {
      result.tier4.sourceMaps = maps;
      result.tier4.status = "done";
      result.confidence = summarizeConfidence(result);
      if (typeof onUpdate === "function") onUpdate(result);
    });

    return result;
  }

  // ctx accepted for the same drop-in shape as study.js/measure.js/point.js's
  // create(ctx); unused here — motion detection needs no chrome, no state.
  function create(ctx) { return { readMotion: readMotion }; }

  return { create: create };
});
