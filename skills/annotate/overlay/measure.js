// Annotate overlay — measure mode. Passive perf recorder: client-side navigations
// (history.pushState/replaceState + Next's RSC payload), Server Action fetches,
// attachment image loads, layout shifts, and long tasks. Everything here is
// read-only observation — nothing intercepts, blocks or rewrites a page
// interaction, which is what makes it safe to leave running while Matt uses the app.
;(function (root, factory) {
  var core = (typeof module !== "undefined" && module.exports) ? require("./core.js") : (root.__annotatorMods && root.__annotatorMods.core);
  var api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.measure = api; }
})(typeof self !== "undefined" ? self : this, function (core) {
  if (!core) throw new Error("annotate: measure.js requires core.js to load first");
  var createPerfBuffer = core.createPerfBuffer;
  var classifyRequest = core.classifyRequest;
  var findRscEntry = core.findRscEntry;

  // ctx = { pal, ui, state, save, persist, notify } — see index.js (Task 5). Only
  // notify() is used here: measure mode owns no annotation state.
  function create(ctx) {
    var notify = ctx.notify;
    var perfBuf = null, perfStop = null;
    // Compare's copy of the run. take() DRAINS perfBuf, and the watch loop calls
    // it every ~25s — so by the time anyone presses "save baseline" the buffer
    // has usually been emptied several times over and a comparison would be run
    // against whatever happened in the last few seconds. This one only resets
    // when recording restarts.
    var session = [], sessionDropped = 0;

    // Next starts the `?_rsc=` navigation request BEFORE it pushes the new URL, so detection
    // looks BACKWARD from the URL change by this much. (Measured live: the request began 45ms
    // before pushState. A forward-only window reported every navigation as a cache hit —
    // exactly backwards.) NAV_SETTLE_MS then allows for the resource entry arriving late.
    var RSC_LOOKBACK_MS = 1200;
    var NAV_SETTLE_MS = 800;

    function start() {
      if (perfStop) return;                                   // idempotent re-entry
      perfBuf = perfBuf || createPerfBuffer(500);
      // Every entry is recorded twice: into the draining buffer the agent reads,
      // and into the session log Compare reads. Wrapping push HERE rather than at
      // the six call sites below means a future entry kind cannot forget to join
      // in. Same 500 cap, and it counts its own drops for the same reason.
      session = []; sessionDropped = 0;
      var buf = { push: function (e) {
        session.push(e);
        if (session.length > 500) { session.shift(); sessionDropped++; }
        perfBuf.push(e);
      } };
      var obs = [], pendingNav = null, navTimer = null;
      var stamp = function () { return Math.round(performance.now()); };

      // --- client-side navigation (channel switching) ---
      // Next routes via history.pushState; a nav that produces NO RSC request was served
      // from the client router cache — the direct answer to the staleTimes question.
      // Resolve exactly once, whichever signal lands first.
      function settleNav(rec, entry) {
        if (rec.__done) return;
        rec.__done = true;
        if (pendingNav === rec) pendingNav = null;
        clearTimeout(navTimer);
        if (entry) {
          rec.servedFromCache = false; rec.rscMs = Math.round(entry.duration);
          rec.ttfbMs = core.ttfbOf(entry); rec.serverTiming = core.serverTimingOf(entry);
        }
        delete rec.__done;
        buf.push(rec); notify();
      }
      function onUrlChange(from, to) {
        if (from === to) return;
        var t0 = performance.now();
        var rec = { t: stamp(), kind: "nav", from: from, to: to, servedFromCache: true, rscMs: null, ttfbMs: null, serverTiming: null, toPaintMs: null };
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { rec.toPaintMs = Math.round(performance.now() - t0); });
        });
        // The request usually already happened — look backward first.
        var hit = null;
        try { hit = findRscEntry(performance.getEntriesByType("resource"), to, t0, RSC_LOOKBACK_MS); } catch (e) {}
        if (hit) return settleNav(rec, hit);
        // Otherwise wait briefly in case its resource entry has not been delivered yet.
        pendingNav = { rec: rec, to: to, at: t0 };
        clearTimeout(navTimer);
        navTimer = setTimeout(function () {
          var p = pendingNav;
          if (!p || p.rec !== rec) return;
          var late = null;
          try { late = findRscEntry(performance.getEntriesByType("resource"), p.to, p.at, RSC_LOOKBACK_MS); } catch (e) {}
          settleNav(rec, late);
        }, NAV_SETTLE_MS);
      }
      var origPush = history.pushState, origReplace = history.replaceState;
      history.pushState = function () { var f = location.href; var r = origPush.apply(this, arguments); onUrlChange(f, location.href); return r; };
      history.replaceState = function () { var f = location.href; var r = origReplace.apply(this, arguments); onUrlChange(f, location.href); return r; };
      var onPop = function () { onUrlChange("(popstate)", location.href); };
      window.addEventListener("popstate", onPop);

      // --- server actions + RSC payloads ---
      // `ms` is time to response HEADERS: the fetch promise resolves there, and reading the
      // body to measure it would consume the stream the framework needs. That is the server's
      // thinking time, which is the number we actually want.
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var kind = null;
        try {
          kind = classifyRequest((init && init.headers) || (input && input.headers) || null);
        } catch (e) { kind = null; }
        if (!kind) return origFetch.apply(this, arguments);
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var t0 = performance.now();
        // Only actions are recorded here. Navigations are detected from resource timings
        // instead — Next does not send its `?_rsc=` payload through this fetch.
        var settle = function (ok) {
          if (kind !== "action") return;
          buf.push({ t: stamp(), kind: "action", url: url, ms: Math.round(performance.now() - t0), ok: ok });
          notify();
        };
        // Never swallow a rejection — re-throw so the app behaves exactly as it would unwrapped.
        return origFetch.apply(this, arguments).then(
          function (res) { settle(!!res.ok); return res; },
          function (err) { settle(false); throw err; }
        );
      };

      // --- images, layout shifts, long tasks ---
      // Each observer is wrapped individually: an entry type this browser does not support
      // must cost us that one signal, not the whole mode.
      var watch = function (type, handler, buffered) {
        try {
          var o = new PerformanceObserver(handler);
          o.observe({ type: type, buffered: !!buffered });
          obs.push(o);
        } catch (e) {}
      };
      watch("resource", function (list) {
        list.getEntries().forEach(function (e) {
          // An RSC payload landing for the nav we are still holding resolves it immediately,
          // rather than waiting out NAV_SETTLE_MS.
          if (pendingNav && e.name.indexOf("_rsc=") > -1) {
            var p = pendingNav;
            if (findRscEntry([e], p.to, p.at, RSC_LOOKBACK_MS)) settleNav(p.rec, e);
          }
          if (!/\/api\/attachments\/|\/storage\/v1\/object\//.test(e.name)) return;
          buf.push({
            t: stamp(), kind: "img", url: e.name,
            ms: Math.round(e.duration),
            ttfbMs: Math.round(e.responseStart ? e.responseStart - e.startTime : 0),
            transferSize: e.transferSize, decodedBodySize: e.decodedBodySize,
            status: e.responseStatus != null ? e.responseStatus : null,
            serverTiming: core.serverTimingOf(e),
          });
        });
        notify();
      });
      watch("layout-shift", function (list) {
        list.getEntries().forEach(function (e) {
          if (e.hadRecentInput || !(e.value > 0.01)) return;
          buf.push({ t: stamp(), kind: "shift", value: Math.round(e.value * 1000) / 1000 });
        });
        notify();
      });
      watch("longtask", function (list) {
        list.getEntries().forEach(function (e) { buf.push({ t: stamp(), kind: "longtask", ms: Math.round(e.duration) }); });
        notify();
      });

      // --- largest contentful paint ---
      // Buffered, because recording starts long after the load LCP describes.
      // One entry per recording, updated in place as later candidates arrive:
      // pushing every candidate would let Compare average the hero image with the
      // heading that painted before it.
      // ponytail: an entry drained by the watch loop before a later candidate
      // lands keeps the earlier value on the agent's side. LCP settles within a
      // few seconds of load and the loop drains every ~25s, so it rarely bites.
      var lcpRec = null;
      var loadPath = (performance.getEntriesByType("navigation")[0] || {}).name || location.href;
      watch("largest-contentful-paint", function (list) {
        var all = list.getEntries(), e = all[all.length - 1];
        if (!e) return;
        var ms = Math.round(e.startTime), el = e.element ? e.element.tagName.toLowerCase() : null;
        if (lcpRec) { lcpRec.t = ms; lcpRec.ms = ms; lcpRec.size = e.size; lcpRec.element = el; }
        else { lcpRec = { t: ms, kind: "lcp", url: loadPath, ms: ms, size: e.size, element: el }; buf.push(lcpRec); }
        notify();
      }, true);

      perfStop = function () {
        obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
        window.fetch = origFetch;
        history.pushState = origPush; history.replaceState = origReplace;
        window.removeEventListener("popstate", onPop);
        clearTimeout(navTimer);
      };
      console.log("[annotate] measure mode ON — recording navigations, actions, images, LCP, shifts, long tasks");
    }

    function stop() { if (perfStop) { perfStop(); perfStop = null; } }

    // Mirrors __annotatorDrain for perf entries; index.js calls notify() itself
    // after taking. Returns [] if start() never ran.
    function take() {
      if (!perfBuf) return [];
      return perfBuf.drain(Math.round(performance.now()));
    }

    // Lets index.js render the pill's "· N" count without reaching into our buffer.
    function size() { return perfBuf ? perfBuf.size() : 0; }

    // The whole recording session, non-draining, for Compare. Returns a COPY —
    // handing out the live array would let a caller mutate the run underneath us,
    // and a saved baseline that changes afterwards is worse than no baseline.
    // The `dropped` marker is prepended in the same shape take() uses, so
    // core.summariseRun sees truncation the one way it knows how to see it.
    function sessionTake() {
      var out = session.slice();
      if (sessionDropped) out = [{ t: Math.round(performance.now()), kind: "dropped", n: sessionDropped }].concat(out);
      return out;
    }

    return { start: start, stop: stop, take: take, size: size, sessionTake: sessionTake };
  }

  return { create: create };
});
