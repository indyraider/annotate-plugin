// Annotate overlay — index. Owns the shared state (window.__annotator,
// window.__annotations, the persisted KEY, the one-shot long-poll waiter),
// builds the palette/UI/mode collaborators and wires them with a shared ctx,
// and exposes the window API the skill's watch loop calls. This is the last
// module loaded — Task 6's loader replaces the old bootstrap-into-localStorage
// mechanism entirely, so that block from overlay.js is deliberately NOT here.
;(function (root, factory) {
  var core, palette, ui, point, measure, study;
  if (typeof module !== "undefined" && module.exports) {
    core = require("./core.js");
    palette = require("./palette.js");
    ui = require("./ui.js");
    point = require("./point.js");
    measure = require("./measure.js");
    study = require("./study.js");
  } else {
    var mods = root.__annotatorMods || {};
    core = mods.core; palette = mods.palette; ui = mods.ui; point = mods.point; measure = mods.measure; study = mods.study;
  }
  var api = factory(core, palette, ui, point, measure, study);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.index = api; }
})(typeof self !== "undefined" ? self : this, function (core, palette, ui, point, measure, study) {
  if (!core) throw new Error("annotate: index.js requires core.js to load first");
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
    function notify() { updateToolbar(); }

    var pal = palette.build();
    var uiHandles = ui.create(pal);
    var ctx = { pal: pal, ui: uiHandles, state: state, save: save, persist: persist, notify: notify };
    var pointMode = point.create(ctx);
    var measureMode = measure.create(ctx);
    var studyMode = study.create(ctx);

    // The toolbar's fixed top row. The internal key for Point is "on" — every
    // mode guard in point.js reads `mode !== "on"` and inverting that makes the
    // other three modes start swallowing clicks, so the LABEL changes here and
    // the key does not.
    //
    // Compare ships disabled rather than absent: Layout B's top row is meant to
    // never change, and a row that grows a fifth button later moves everything
    // the user has learned to aim at. It is spec §8 Phase 3.
    var MODES = [
      { key: "on", label: "Point", title: "Comment on your own app" },
      { key: "measure", label: "Measure", title: "Record real performance while you drive" },
      { key: "compare", label: "Compare", title: "Baseline vs re-run — not built yet (Phase 3)", disabled: true },
      { key: "study", label: "Study", title: "Take apart any site's design" }
    ];
    // Alt+A's cycle. Derived from MODES rather than written out, so a mode that
    // ships disabled can never become a dead stop in the rotation. The rotation
    // itself is core.nextMode — pure, and tested in Node rather than grepped for.
    var CYCLE_KEYS = MODES.filter(function (m) { return !m.disabled; }).map(function (m) { return m.key; });

    function updateToolbar() {
      var m = state.mode, c = window.__annotations.length;
      uiHandles.setActiveMode(m);
      uiHandles.setQueueCount(c);
      uiHandles.setQueueItems(window.__annotations.map(function (a) {
        return { id: a.id, n: a.n, text: a.comment || "(no text)", status: a.status };
      }), function (id) { if (pointMode.reveal) pointMode.reveal(id); });

      // Row 2 is whatever the selected mode needs. ui.js has no idea any of
      // these strings exist; it draws the node it is handed.
      if (m === "measure") {
        uiHandles.setClickHint("Passes through (recording)");
        uiHandles.setModeTools(uiHandles.toolsText("Recording — clicks pass straight through · " + measureMode.size() + " entries"));
      } else if (m === "study") {
        uiHandles.setClickHint("Pin the readout");
        uiHandles.setModeTools(uiHandles.favPanel);
      } else if (m === "on") {
        uiHandles.setClickHint("Leave a comment");
        uiHandles.setModeTools(uiHandles.toolsText("Click an element to comment · hold Shift to click through"));
      } else {
        uiHandles.setClickHint("Leave a comment");
        uiHandles.setModeTools(null);
      }
    }

    // point mode (crosshair/highlight/inspector) and study mode (hover/pin
    // readout) are entered/left via enable()/disable(); measure mode is
    // entirely passive (start()/stop()).
    function setMode(next) {
      state.mode = next;
      if (next === "on") pointMode.enable(); else pointMode.disable();
      if (next === "measure") measureMode.start(); else measureMode.stop();
      if (next === "study") studyMode.enable(); else studyMode.disable();
      updateToolbar();
    }
    // Clicking the mode you are already in leaves it. Without this, "off" is
    // only reachable by cycling all the way round with Alt+A, and off is the
    // state you want the instant you need to actually USE the page.
    function selectMode(key) { setMode(state.mode === key ? "off" : key); }
    function toggle() { setMode(core.nextMode(state.mode, CYCLE_KEYS)); }
    uiHandles.setModes(MODES, selectMode);

    // ui.js only knows it collected a note and a comma-separated tags string —
    // it has no idea a "study mode" or a "favourite" concept exists. index.js
    // is the one that turns that into the real pin-and-record action below.
    uiHandles.onFavouriteSave(function (note, tagsText) {
      var tags = tagsText ? tagsText.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 0; }) : [];
      studyMode.favourite(note, tags);
    });

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
      updateToolbar();
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
    // Same Promise contract as __annotatorStudyTake — takeFavourite() reuses
    // take() under the hood, so this can never hand back a permanent
    // {status:"sampling"} placeholder either.
    window.__annotatorStudyFavourite = function () { return studyMode.takeFavourite(); };

    updateToolbar();
    console.log("[annotate] overlay ready — Alt+A toggle · hover = inspect · Shift = click-through · ⌘V attaches an image · ? = shortcuts");
  }

  return { setup: __setupAnnotator };
});
