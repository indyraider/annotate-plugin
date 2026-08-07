// Annotate overlay — index. Owns the shared state (window.__annotator,
// window.__annotations, the persisted KEY, the one-shot long-poll waiter),
// builds the palette/UI/mode collaborators and wires them with a shared ctx,
// and exposes the window API the skill's watch loop calls. This is the last
// module loaded — Task 6's loader replaces the old bootstrap-into-localStorage
// mechanism entirely, so that block from overlay.js is deliberately NOT here.
;(function (root, factory) {
  var palette, ui, point, measure, study;
  if (typeof module !== "undefined" && module.exports) {
    palette = require("./palette.js");
    ui = require("./ui.js");
    point = require("./point.js");
    measure = require("./measure.js");
    study = require("./study.js");
  } else {
    var mods = root.__annotatorMods || {};
    palette = mods.palette; ui = mods.ui; point = mods.point; measure = mods.measure; study = mods.study;
  }
  var api = factory(palette, ui, point, measure, study);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.index = api; }
})(typeof self !== "undefined" ? self : this, function (palette, ui, point, measure, study) {
  if (!palette) throw new Error("annotate: index.js requires palette.js to load first");
  if (!ui) throw new Error("annotate: index.js requires ui.js to load first");
  if (!point) throw new Error("annotate: index.js requires point.js to load first");
  if (!measure) throw new Error("annotate: index.js requires measure.js to load first");
  if (!study) throw new Error("annotate: index.js requires study.js to load first");

  function __setupAnnotator() {
    if (window.__annotator) return;                 // idempotent re-inject guard
    window.__annotator = { mode: "off" };
    var state = window.__annotator;
    var KEY = "__annotations";
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
    var persist = function () { try { localStorage.setItem(KEY, JSON.stringify(window.__annotations)); } catch (e) {} };
    window.__annotations = load();

    var waiter = null; // { resolve, timer } — one-shot long-poll resolver

    // Appends a saved annotation and wakes a pending long-poll. Persisting and
    // repainting the pill are the caller's job (point.js's record() does both
    // right after this) — this only owns the append + wake.
    function save(record) {
      window.__annotations.push(record);
      if (waiter) { var w = waiter; waiter = null; clearTimeout(w.timer); w.resolve(); }  // wake the long-poll
    }
    function notify() { updatePill(); }

    var pal = palette.build();
    var uiHandles = ui.create(pal);
    var ctx = { pal: pal, ui: uiHandles, state: state, save: save, persist: persist, notify: notify };
    var pointMode = point.create(ctx);
    var measureMode = measure.create(ctx);
    var studyMode = study.create(ctx);

    function updatePill() {
      var m = state.mode, c = window.__annotations.length;
      if (m === "measure") {
        uiHandles.setPillLabel("◉ Measure: REC" + (measureMode.size() ? " · " + measureMode.size() : ""), pal.accent, pal.accentFg);
      } else if (m === "study") {
        uiHandles.setPillLabel("◈ Study", pal.accent, pal.accentFg);
      } else if (m === "on") {
        uiHandles.setPillLabel("● Annotate: ON" + (c ? " · " + c : ""), pal.accent, pal.accentFg);
      } else {
        uiHandles.setPillLabel("○ Annotate: OFF" + (c ? " · " + c : ""), pal.surface2, pal.text2);
      }
    }

    // off -> on -> measure -> study -> off. point mode (crosshair/highlight/inspector)
    // and study mode (hover/pin readout) are entered/left via enable()/disable();
    // measure mode is entirely passive (start()/stop()).
    function toggle() {
      var m = state.mode;
      var next = m === "off" ? "on" : m === "on" ? "measure" : m === "measure" ? "study" : "off";
      state.mode = next;
      if (next === "on") pointMode.enable(); else pointMode.disable();
      if (next === "measure") measureMode.start(); else measureMode.stop();
      if (next === "study") studyMode.enable(); else studyMode.disable();
      updatePill();
    }
    uiHandles.pill.addEventListener("click", toggle);

    // Alt+A must be attached UNCONDITIONALLY, not inside point mode's enable()/
    // disable() bracket — mode is "off" (point mode disabled) at the exact
    // moment this needs to fire to turn it back on.
    document.addEventListener("keydown", function (e) {
      if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggle(); }
    }, true);

    // ---- long-poll API for the skill's watch loop ----
    window.__annotatorDrain = function () { var f = window.__annotations.filter(function (a) { return a.status === "new"; }); f.forEach(function (a) { a.status = "seen"; }); persist(); return f; };
    // Mirrors __annotatorDrain for perf entries. Returns [] if measure mode never ran.
    window.__annotatorPerfTake = function () {
      var out = measureMode.take();
      updatePill();
      return out;
    };
    window.__annotatorWait = function (timeoutMs) {
      return new Promise(function (resolve) {
        if (window.__annotations.some(function (a) { return a.status === "new"; })) return resolve(window.__annotatorDrain());
        if (waiter) { clearTimeout(waiter.timer); waiter.resolve(); }               // supersede a stale waiter
        var timer = setTimeout(function () { waiter = null; resolve([]); }, timeoutMs || 25000);
        waiter = { timer: timer, resolve: function () { resolve(window.__annotatorDrain()); } };
      });
    };
    window.__annotatorReveal = pointMode.reveal;
    window.__annotatorImageTake = pointMode.takeImage;
    // Study's two agent-facing entry points. Take() returns a Promise (see study.js —
    // it awaits the motion sample so the agent never receives a permanent "sampling"
    // placeholder); page() is fully synchronous already, so no Promise wrapping needed.
    window.__annotatorStudyTake = function () { return studyMode.take(); };
    window.__annotatorStudyPage = function () { return studyMode.readPage(); };

    updatePill();
    console.log("[annotate] overlay ready — Alt+A toggle · hover = inspect · Shift = click-through · ⌘V attaches an image · ? = shortcuts");
  }

  return { setup: __setupAnnotator };
});
