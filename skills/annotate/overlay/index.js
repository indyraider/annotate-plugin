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
    var MODES = [
      { key: "on", label: "Point", title: "Comment on your own app" },
      { key: "measure", label: "Measure", title: "Record real performance while you drive" },
      { key: "compare", label: "Compare", title: "Baseline vs re-run — prove the fix worked" },
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
        // Reached on every pin change (study.js notifies), so a confirmation
        // from the previous element never lingers over a new one.
        uiHandles.setFavouriteStatus("");
      } else if (m === "compare") {
        uiHandles.setClickHint("Passes through");
        uiHandles.setModeTools(uiHandles.comparePanel);
        uiHandles.setCompareStatus(compareStatusLine());
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

    // ---- Compare: baseline vs re-run ----
    // The baseline lives in localStorage, not memory, because the whole point is
    // that the agent does a chunk of work in between — and editing a component
    // the page uses triggers an HMR reload, which would take an in-memory
    // baseline with it and silently leave nothing to compare against.
    var BASELINE_KEY = "__ann_baseline";
    function loadBaseline() {
      try { var raw = localStorage.getItem(BASELINE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function compareStatusLine() {
      var b = loadBaseline();
      var live = measureMode.sessionTake().length;
      if (!b) return "No baseline yet. Record in Measure, then come back and save one. (" + live + " entries recorded now)";
      return "Baseline: " + b.entries.length + " entries, saved " + b.savedAt + " on " + b.url + " · current run: " + live + " entries";
    }
    // A row the user can read at a glance. The maths stays in core; this only
    // decides the words. "thin" is carried through deliberately — a one-sample
    // result that reads like a measurement is exactly the mistake that made a
    // headline performance finding evaporate once.
    function compareRowText(r) {
      var name = r.key;
      if (r.verdict === "added") return { label: name, detail: "new", tone: "flat" };
      if (r.verdict === "gone") return { label: name, detail: "gone", tone: "flat" };
      var ms = Math.round(r.deltaMs);
      var pct = r.deltaPct === null ? "" : " (" + (r.deltaPct > 0 ? "+" : "") + Math.round(r.deltaPct * 100) + "%)";
      if (r.verdict === "same") return { label: name, detail: "~ unchanged", tone: "flat" };
      var arrow = r.verdict === "slower" ? "▲ +" : "▼ ";
      return {
        label: name + (r.thin ? "  · one sample" : ""),
        detail: arrow + ms + "ms" + pct,
        tone: r.verdict === "slower" ? "bad" : "good"
      };
    }
    function runCompare() {
      var b = loadBaseline();
      if (!b) { uiHandles.setCompareStatus("Nothing to compare against — save a baseline first."); uiHandles.setCompareRows([]); return null; }
      var current = measureMode.sessionTake();
      var result = core.compareRuns(b.entries, current);
      var rows = uiHandles.isRegressionsOnly() ? result.regressions : result.rows;
      uiHandles.setCompareRows(rows.map(compareRowText));
      var head = result.rows.length
        ? result.regressions.length + " slower, " + result.rows.filter(function (r) { return r.verdict === "faster"; }).length + " faster, of " + result.rows.length
        : "Nothing measured in both runs — record the same journey again before comparing";
      // Truncation must never read as a complete comparison.
      if (result.truncated) head += " · TRUNCATED, " + (result.dropped.before + result.dropped.after) + " entries were dropped";
      uiHandles.setCompareStatus(head);
      return result;
    }
    uiHandles.onAct("cmp-save", function () {
      var entries = measureMode.sessionTake();
      var rec = { savedAt: new Date().toISOString().slice(11, 19), url: location.pathname, entries: entries };
      try { localStorage.setItem(BASELINE_KEY, JSON.stringify(rec)); } catch (e) {
        uiHandles.setCompareStatus("Could not save the baseline — storage refused it (" + (e && e.name) + ")");
        return;
      }
      uiHandles.setCompareRows([]);
      uiHandles.setCompareStatus(entries.length
        ? "Baseline saved: " + entries.length + " entries. Now let the agent work, re-run the same journey in Measure, and press Compare."
        : "Baseline saved, but it is EMPTY — nothing was recorded. Switch to Measure, drive the journey, then save again.");
    });
    uiHandles.onAct("cmp-run", runCompare);
    uiHandles.onAct("cmp-filter", function () { if (loadBaseline()) runCompare(); });

    // ui.js only knows it collected a note and a comma-separated tags string —
    // it has no idea a "study mode" or a "favourite" concept exists. index.js
    // is the one that turns that into the real pin-and-record action below.
    uiHandles.onFavouriteSave(function (note, tagsText) {
      var tags = tagsText ? tagsText.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 0; }) : [];
      var saved = studyMode.favourite(note, tags);
      // favourite() returns null when nothing is pinned, and that used to be the
      // whole story — no message, no error, nothing on screen either way. Both
      // outcomes now say what happened; the no-op case says what to do instead,
      // because "click an element first" is not guessable from a dead button.
      if (!saved) {
        uiHandles.setFavouriteStatus("Click an element on the page first, then save.", false);
        return;
      }
      uiHandles.setFavouriteStatus("★ Saved" + (tags.length ? " · " + tags.join(", ") : "") + " — pull it with __annotatorStudyFavourite()", true);
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

    // Compare's agent-facing entry points. Synchronous — there is no sampling
    // here, only arithmetic over entries already recorded.
    // __annotatorCompareTake() returns the FULL result (rows, regressions,
    // truncated, dropped, thresholds), never just the regressions: a caller that
    // only ever sees regressions cannot tell "nothing got worse" apart from
    // "nothing was measured in both runs", and those need different answers.
    window.__annotatorCompareTake = function () {
      var b = loadBaseline();
      if (!b) return { error: "no-baseline", rows: [], regressions: [] };
      return core.compareRuns(b.entries, measureMode.sessionTake());
    };
    // Saving and clearing from the agent side, so a journey can be driven with
    // browser_click and baselined without anyone touching the toolbar.
    window.__annotatorCompareSaveBaseline = function () {
      var entries = measureMode.sessionTake();
      try { localStorage.setItem(BASELINE_KEY, JSON.stringify({ savedAt: new Date().toISOString().slice(11, 19), url: location.pathname, entries: entries })); } catch (e) { return { ok: false, error: String(e && e.name) }; }
      updateToolbar();
      return { ok: true, entries: entries.length };
    };
    window.__annotatorCompareClearBaseline = function () {
      try { localStorage.removeItem(BASELINE_KEY); } catch (e) {}
      updateToolbar();
      return { ok: true };
    };

    updateToolbar();
    console.log("[annotate] overlay ready — Alt+A toggle · hover = inspect · Shift = click-through · ⌘V attaches an image · ? = shortcuts");
  }

  return { setup: __setupAnnotator };
});
