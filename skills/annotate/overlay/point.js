// Annotate overlay — point mode. Hover-to-inspect, click-to-comment, with a per-
// annotation image attachment (paste or drop, never a file input — Chrome routes
// a file chooser to the automation client, so the user sees nothing and the
// agent's next tool call jams). Takes a ctx from index.js instead of closing over
// its scope, so this module is reviewable on its own.
;(function (root, factory) {
  var core = (typeof module !== "undefined" && module.exports) ? require("./core.js") : (root.__annotatorMods && root.__annotatorMods.core);
  var palette = (typeof module !== "undefined" && module.exports) ? require("./palette.js") : (root.__annotatorMods && root.__annotatorMods.palette);
  var api = factory(core, palette);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.point = api; }
})(typeof self !== "undefined" ? self : this, function (core, palette) {
  if (!core) throw new Error("annotate: point.js requires core.js to load first");
  if (!palette) throw new Error("annotate: point.js requires palette.js to load first");
  var buildSelector = core.buildSelector;
  var fitDimensions = core.fitDimensions;
  var SANS = palette.SANS;

  // The page's own fetch, captured at LOAD, before measure.js or the context
  // hooks wrap it. The overlay's lookups go through this, so they never show up
  // as the page's traffic. On window so a second copy of this module keeps the
  // first, unwrapped one.
  if (typeof window !== "undefined" && !window.__annotatorRawFetch) window.__annotatorRawFetch = window.fetch;

  // ---- silent context: hooked at LOAD, not in create() ----
  // The error worth knowing about happened before the click that reported it,
  // and create() only runs when the agent calls setup(). addInitScript injects
  // this module ahead of the page's own scripts, so hooking here sees the app
  // from its first line. The logs live on window so a second copy of this module
  // adds no second set of hooks and reads the same history.
  // ponytail: fetch only; XMLHttpRequest failures are not captured. Add an XHR
  // hook if an app that still uses it shows up.
  if (typeof window !== "undefined" && !window.__annotatorContext) {
    var clip = function (v) { return String(v).slice(0, 300); };
    var text = function (v) {
      if (v instanceof Error) return v.stack || v.message;
      if (v && typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }
      return String(v);
    };
    var log = window.__annotatorContext = { errors: core.createRecentLog(20), requests: core.createRecentLog(20) };
    var pageConsoleError = console.error;
    console.error = function () {
      try { log.errors.push({ t: Date.now(), source: "console.error", message: clip(Array.prototype.map.call(arguments, text).join(" ")) }); } catch (e) {}
      return pageConsoleError.apply(this, arguments);
    };
    window.addEventListener("error", function (e) {
      var t = e.target;
      // A failed <img>/<script>/<link> fires a non-bubbling error that only a
      // capture listener on window sees. It carries the URL and no status.
      if (t && t !== window && (t.src || t.href)) log.requests.push({ t: Date.now(), url: clip(t.src || t.href), status: null, error: "<" + String(t.tagName).toLowerCase() + "> failed to load" });
      else log.errors.push({ t: Date.now(), source: "uncaught", message: clip((e.error && e.error.stack) || e.message) });
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      log.errors.push({ t: Date.now(), source: "unhandledrejection", message: clip(text(e.reason)) });
    });
    var pageFetch = window.fetch;
    if (pageFetch) window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || String(input);
      // Always delegates, always re-throws: the app sees exactly what it would unwrapped.
      return pageFetch.apply(this, arguments).then(function (res) {
        if (!res.ok && res.type !== "opaque") log.requests.push({ t: Date.now(), url: clip(url), status: res.status, error: null });
        return res;
      }, function (err) {
        log.requests.push({ t: Date.now(), url: clip(url), status: null, error: clip(text(err)) });
        throw err;
      });
    };
  }

  // ctx = { pal, ui, state, save, persist, notify } — see index.js (Task 5).
  function create(ctx) {
    var pal = ctx.pal, ui = ctx.ui, state = ctx.state, save = ctx.save, wake = ctx.wake, persist = ctx.persist, notify = ctx.notify;
    var Z = 2147483647;

    // ---- attached images ----
    // Kept OUT of the `__annotations` blob on purpose: one pasted screenshot can
    // exceed the whole localStorage quota, and a throwing setItem there would
    // silently stop persisting every annotation. Each image gets its own key, and
    // an in-memory map is the fallback when the quota says no.
    var IMG_KEY = "__ann_img_";
    var IMG_MAX_PX = 1600;                       // longest side after downscale
    window.__annotatorImages = window.__annotatorImages || {};
    function putImage(id, dataUrl) {
      window.__annotatorImages[id] = dataUrl;    // always in memory (survives a full quota)
      try { localStorage.setItem(IMG_KEY + id, dataUrl); } catch (e) {}  // …and disk when it fits
    }
    /** Read-and-forget: the agent pulls each image once, then it's dropped from memory
     *  and localStorage. The most recent one stays retrievable until the NEXT take
     *  replaces it — a transfer that fails after the call ran (bad output path, tool
     *  error) would otherwise destroy the only copy, which is exactly what happened the
     *  first time this shipped. Retrying the same id gets the image back. */
    function takeImage(id) {
      var last = window.__annotatorLastTaken;
      var d = window.__annotatorImages[id] || null;
      if (!d) { try { d = localStorage.getItem(IMG_KEY + id); } catch (e) { d = null; } }
      if (!d && last && last.id === id) d = last.data;      // retry of a failed transfer
      if (d) window.__annotatorLastTaken = { id: id, data: d };
      delete window.__annotatorImages[id];
      try { localStorage.removeItem(IMG_KEY + id); } catch (e) {}
      return d;
    }
    /** File/Blob → downscaled JPEG data URL. Rejects non-images by resolving null. */
    function toDataUrl(file) {
      return new Promise(function (resolve) {
        if (!file || !/^image\//.test(file.type)) return resolve(null);
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var d = fitDimensions(img.naturalWidth, img.naturalHeight, IMG_MAX_PX);
          var cv = document.createElement("canvas");
          cv.width = d.w; cv.height = d.h;
          cv.getContext("2d").drawImage(img, 0, 0, d.w, d.h);
          URL.revokeObjectURL(url);
          try { resolve(cv.toDataURL("image/jpeg", 0.9)); } catch (e) { resolve(null); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
    }

    // ---- element -> source (React 19) ----
    // React 19 dropped fiber._debugSource, so this used to return null on every
    // comment and the agent fell back to grepping page text. Measured 2026-09-17
    // on React 19.2.4 / Next 16.3 Turbopack dev: every fiber still carries
    // _debugOwner (the component that rendered it) and _debugStack (whose third
    // line is the compiled JSX call site). Next's dev server maps a compiled site
    // back to a file through the endpoint its own error overlay uses.
    var SOURCE_WAIT_MS = 1500;
    var FIBER_WALK = 25;
    function fiberOf(el) {
      var k = Object.keys(el).find(function (x) { return x.indexOf("__reactFiber$") === 0 || x.indexOf("__reactInternalInstance$") === 0; });
      return k ? el[k] : null;
    }
    // A client owner is a fiber with the name on its type; a server owner is
    // plain component info carrying its own name.
    function ownerName(o) {
      if (!o) return null;
      if (o.type && typeof o.type !== "string") return o.type.displayName || o.type.name || null;
      return typeof o.name === "string" ? o.name : null;
    }
    // Nearest first, e.g. ["LoginFormInner", "LoginForm", "LoginPage"]. Works on
    // any React 19 dev build, Next or not, and a component name greps straight to
    // its definition when the file lookup comes back empty.
    function components(el) {
      var out = [];
      try {
        var f = fiberOf(el);
        for (var i = 0; f && i < FIBER_WALK && out.length < 5; i++, f = f.return) {
          var n = ownerName(f._debugOwner);
          if (n && out.indexOf(n) === -1) out.push(n);
        }
      } catch (e) {}
      return out;
    }
    // Next's build directory, read off the root layout's server frame. Memoised
    // once found; it cannot change while the page lives.
    var distDirMemo = null;
    function distDir() {
      if (distDirMemo) return distDirMemo;
      try {
        var f = fiberOf(document.documentElement);
        for (var i = 0; f && i < FIBER_WALK; i++, f = f.return) {
          var fr = f._debugStack && core.parseDebugStack(f._debugStack.stack);
          var d = fr && core.nextDistDir(fr.file);
          if (d) return (distDirMemo = d);
        }
      } catch (e) {}
      return null;
    }
    // Resolves { file, line, column, via } or null. Never rejects, never waits
    // longer than SOURCE_WAIT_MS. React <= 18's _debugSource first, then Next's
    // dev endpoint. No dist dir means this is not a Next App Router dev page, and
    // nothing is POSTed to a server that has no such endpoint.
    // ponytail: Next App Router dev only; Vite or the Pages Router get component
    // names and a grep. Add a source-map reader if those become real users.
    function resolveSource(el) {
      var frames = [];
      try {
        var f = fiberOf(el);
        for (var i = 0; f && i < FIBER_WALK; i++, f = f.return) {
          var s = f._debugSource;
          if (s) return Promise.resolve({ file: s.fileName, line: s.lineNumber, column: s.columnNumber || null, via: "react-debug-source" });
          var fr = f._debugStack && core.parseDebugStack(f._debugStack.stack);
          if (fr) frames.push(fr);
        }
      } catch (e) {}
      var dist = distDir();
      if (!frames.length || !dist || !window.__annotatorRawFetch) return Promise.resolve(null);
      frames.forEach(function (fr) { fr.file = core.toNextFrameFile(fr.file, dist); });
      var lookup = window.__annotatorRawFetch.call(window, "/__nextjs_original-stack-frames", {
        method: "POST",
        body: JSON.stringify({ frames: frames, isServer: false, isEdgeServer: false, isAppDirectory: true })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { var hit = core.firstAppFrame(data); if (hit) hit.via = "next-dev"; return hit; })
        .catch(function () { return null; });
      var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, SOURCE_WAIT_MS); });
      return Promise.race([lookup, giveUp]);
    }

    function describe(el) {
      var attrs = {};
      var list = el.attributes || [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i].name;
        if (n.indexOf("data-") === 0 || n === "aria-label" || n === "role" || n === "name") attrs[n] = list[i].value;
      }
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : "",
        id: el.id || null,
        className: (typeof el.className === "string" ? el.className : "") || null,
        text: (el.textContent || "").trim().slice(0, 120) || null,
        attrs: attrs,
        components: components(el),
        source: null                       // record() fills this in once resolveSource settles
      };
    }

    // ---- comment box, badge, paste/drop ----
    function btn(label, primary) { var b = document.createElement("button"); b.textContent = label; Object.assign(b.style, { background: primary ? pal.accent : pal.hover, color: primary ? pal.accentFg : pal.text, border: primary ? "none" : "1px solid " + pal.border, borderRadius: "6px", padding: "5px 10px", font: "600 12px " + SANS, cursor: "pointer" }); return b; }
    // ---- multi-select: ⌘/Ctrl+click gathers elements into the next comment ----
    // Not Shift, which the spec first named: Shift is already "peek", the
    // click-through Point users rely on, and taking it would break that.
    var picks = [];                                  // [{ el, mark }]
    function togglePick(el) {
      for (var i = 0; i < picks.length; i++) {
        if (picks[i].el === el) { picks[i].mark.remove(); picks.splice(i, 1); return; }
      }
      var r = el.getBoundingClientRect();
      var mark = document.createElement("div"); mark.className = "__ann-ui"; mark.setAttribute("data-ann-pick", "");
      Object.assign(mark.style, { position: "absolute", left: (r.left + window.scrollX - 3) + "px", top: (r.top + window.scrollY - 3) + "px", width: (r.width + 6) + "px", height: (r.height + 6) + "px", border: "2px dashed " + pal.accent, borderRadius: "5px", boxSizing: "border-box", pointerEvents: "none", zIndex: Z - 1 });
      document.body.appendChild(mark);
      picks.push({ el: el, mark: mark });
    }
    function clearPicks() { picks.forEach(function (p) { p.mark.remove(); }); picks = []; }

    var box = null, target = null, pendingImage = null, pendingShot = null;
    function openComment(el, x, y, shot) {
      closeComment(); target = el; pendingShot = shot || null;
      box = document.createElement("div"); box.className = "__ann-ui";
      Object.assign(box.style, { position: "fixed", left: Math.min(x, window.innerWidth - 260) + "px", top: Math.min(y, window.innerHeight - 180) + "px", zIndex: Z, width: "244px", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "8px", padding: "8px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", font: "12px " + SANS, color: pal.text });
      // ---- walk the tree: the click landed on a <span>, the comment is about the card ----
      var trail = [];                                // elements walked up from, nearest last
      var walk = document.createElement("div");
      Object.assign(walk.style, { display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px" });
      var where = document.createElement("span");
      Object.assign(where.style, { flex: "1", minWidth: "0", font: "11px " + SANS, color: pal.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
      var upBtn = btn("↑", false), downBtn = btn("↓", false);
      upBtn.title = "Parent element (Alt+↑)"; downBtn.title = "Back down (Alt+↓)";
      upBtn.style.padding = "2px 7px"; downBtn.style.padding = "2px 7px";
      function parentOf(n) { var p = n.parentElement; return p && p !== document.documentElement ? p : null; }
      function paintWhere() {
        var cls = (typeof target.className === "string" && target.className.trim()) ? "." + target.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        where.textContent = target.tagName.toLowerCase() + cls + (picks.length ? "  + " + picks.length + " more" : "");
        upBtn.disabled = !parentOf(target); downBtn.disabled = !trail.length;
        ui.showHighlight(target);
      }
      function walkUp() { var p = parentOf(target); if (!p) return; trail.push(target); target = p; paintWhere(); }
      function walkDown() { if (!trail.length) return; target = trail.pop(); paintWhere(); }
      upBtn.onclick = walkUp; downBtn.onclick = walkDown;
      walk.append(where, upBtn, downBtn);
      var ta = document.createElement("textarea"); ta.placeholder = "What should change here?  (⌘/Ctrl+Enter to save)";
      Object.assign(ta.style, { width: "100%", height: "66px", resize: "none", background: pal.surface, color: pal.text, border: "1px solid " + pal.border, borderRadius: "6px", padding: "6px", font: "12px " + SANS, boxSizing: "border-box", outline: "none" });
      ta.addEventListener("focus", function () { ta.style.borderColor = pal.accent; });
      ta.addEventListener("blur", function () { ta.style.borderColor = pal.border; });

      // ---- image attachment: ⌘V into the box, or drop a file on it ----
      // Deliberately NOT an <input type="file">: this browser is Playwright-driven, and
      // Chrome hands the file chooser to the automation client instead of showing the OS
      // dialog — Matt would see nothing and every pending chooser blocks the agent's next
      // tool call. Paste and drag-and-drop both bypass the chooser entirely.
      var thumbWrap = document.createElement("div");
      Object.assign(thumbWrap.style, { display: "none", position: "relative", marginTop: "6px" });
      var thumb = document.createElement("img");
      Object.assign(thumb.style, { display: "block", width: "100%", borderRadius: "6px", border: "1px solid " + pal.border });
      var dropImg = document.createElement("button"); dropImg.textContent = "✕"; dropImg.type = "button";
      dropImg.setAttribute("aria-label", "Remove attached image");
      Object.assign(dropImg.style, { position: "absolute", top: "4px", right: "4px", width: "18px", height: "18px", borderRadius: "999px", border: "1px solid " + pal.border, background: pal.elevated, color: pal.text2, font: "600 10px/1 " + SANS, cursor: "pointer" });
      dropImg.onclick = function () { setImage(null); };
      thumbWrap.append(thumb, dropImg);

      var IDLE_HINT = "⌘V or drop an image";
      function setImage(dataUrl) {
        pendingImage = dataUrl;
        thumb.src = dataUrl || "";
        thumbWrap.style.display = dataUrl ? "block" : "none";
        hint.textContent = dataUrl ? "image attached" : IDLE_HINT;
      }
      function attach(file) {
        hint.textContent = "reading image…";
        toDataUrl(file).then(function (d) { setImage(d); if (!d) hint.textContent = "not an image"; });
      }

      // Drag a file straight from Finder onto the comment box.
      box.addEventListener("dragover", function (e) {
        e.preventDefault(); e.stopPropagation();
        box.style.borderColor = pal.accent; hint.textContent = "drop to attach";
      });
      box.addEventListener("dragleave", function (e) {
        if (box.contains(e.relatedTarget)) return;          // moving between children isn't a leave
        box.style.borderColor = pal.border; if (!pendingImage) hint.textContent = IDLE_HINT;
      });
      box.addEventListener("drop", function (e) {
        e.preventDefault(); e.stopPropagation();
        box.style.borderColor = pal.border;
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) attach(f); else if (!pendingImage) hint.textContent = IDLE_HINT;
      });

      // Clipboard paste — the whole point: Cmd+Shift+Ctrl+4 then ⌘V, no file ever hits disk.
      ta.addEventListener("paste", function (e) {
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
            e.preventDefault(); attach(items[i].getAsFile()); return;
          }
        }
      });

      var row = document.createElement("div"); Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" });
      var hint = document.createElement("span");
      Object.assign(hint.style, { flex: "1", font: "10px " + SANS, color: pal.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
      hint.textContent = IDLE_HINT;
      var cancel = btn("Cancel", false), saveBtn = btn("Save", true);
      var submit = function () {
        var v = ta.value.trim();
        var els = [target].concat(picks.map(function (p) { return p.el; }).filter(function (x) { return x !== target; }));
        if (v) record(els, v, pendingImage, pendingShot);
        clearPicks(); closeComment();
      };
      cancel.onclick = function () { clearPicks(); closeComment(); }; saveBtn.onclick = submit;
      ta.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); walkUp(); }
        else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); walkDown(); }
      });
      row.append(hint, cancel, saveBtn);
      box.append(walk, ta, thumbWrap, row); document.body.appendChild(box); paintWhere(); ta.focus();
    }
    function closeComment() { if (box) { box.remove(); box = null; target = null; pendingImage = null; } pendingShot = null; }

    // Comment-pin marker: rounded bubble with one pointed corner (bottom-left) aimed at
    // the element, wrapping an accent chip with the number — like a map/comment pin.
    function addBadge(el, n) {
      var r = el.getBoundingClientRect();
      var pin = document.createElement("div"); pin.className = "__ann-ui";
      Object.assign(pin.style, { position: "absolute", left: (r.left + window.scrollX - 8) + "px", top: (r.top + window.scrollY - 26) + "px", zIndex: Z, padding: "3px", display: "inline-flex", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "12px 12px 12px 3px", boxShadow: "0 3px 8px rgba(0,0,0,.5)", pointerEvents: "none" });
      var inner = document.createElement("div"); inner.textContent = n;
      Object.assign(inner.style, { minWidth: "18px", height: "18px", padding: "0 4px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: pal.accent, color: pal.accentFg, font: "700 11px/1 " + SANS, borderRadius: "6px 6px 6px 2px" });
      pin.appendChild(inner); document.body.appendChild(pin);
    }

    // Page-wide, not per-element: an error cannot be traced to the element it
    // broke. What is honest is "this happened on the page in the 30s before".
    var CONTEXT_WINDOW_MS = 30000;
    function recentContext() {
      var log = window.__annotatorContext;
      if (!log) return null;
      var since = Date.now() - CONTEXT_WINDOW_MS;
      return { windowMs: CONTEXT_WINDOW_MS, errors: log.errors.since(since), failedRequests: log.requests.since(since) };
    }

    // seq lives here, not in index.js: no other mode assigns annotation ids.
    var seq = window.__annotations.reduce(function (m, a) { return Math.max(m, a.n || 0); }, 0);
    function record(els, comment, image, shot) {
      seq += 1;
      var el = els[0];
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el),
        others: els.slice(1).map(function (o) { return { selector: buildSelector(o), descriptor: describe(o) }; }),
        comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "resolving", hasImage: !!image, hasShot: !!shot, context: recentContext() };
      // Neither image rides along in the annotation — the agent pulls each by id.
      if (image) putImage(a.id, image);
      if (shot) putImage(a.id + "-shot", shot);
      // Saved, persisted and badged NOW, so a navigation in the next second
      // cannot lose the comment. Handed to the agent only once every lookup
      // settles, so the agent never reads a source that is still on its way.
      save(a); persist(); els.forEach(function (x) { addBadge(x, seq); }); notify();
      Promise.all(els.map(resolveSource)).then(function (srcs) {
        a.descriptor.source = srcs[0];
        a.others.forEach(function (o, i) { o.descriptor.source = srcs[i + 1]; });
        a.status = "new";
        persist(); wake(); notify();
      });
    }

    // ---- events (capture phase; only act in ON mode; never swallow our own UI) ----
    // Hold Shift = "peek": every handler bails, so the app behaves normally for one
    // interaction (open a dropdown/modal) without leaving annotate mode.
    function onMousemove(e) {
      if (state.mode !== "on") return;
      // While the box is open the ring marks what the comment is ABOUT, which the
      // tree walk can move. Following the mouse would point it at the wrong thing,
      // and this check has to come FIRST: the ↑/↓ buttons are our own chrome, so
      // the isOurs branch below used to hide the ring the moment the mouse left
      // them, with nothing to bring it back (reported live, 2026-09-17).
      if (box) { ui.hideInspector(); return; }
      if (e.shiftKey || ui.isOurs(e.target)) { ui.hideHighlight(); ui.hideInspector(); return; }
      ui.showHighlight(e.target);
      ui.showInspector(e.target, e.clientX, e.clientY);
    }
    // While ON, kill every nav vector on non-our elements so a click can't navigate:
    // SPA handlers fire on pointerdown/mousedown (stopPropagation keeps them from running),
    // native <a> nav + middle-click fire on click/auxclick (preventDefault). Click then opens the box.
    function blockNav(e) { if (state.mode !== "on") return; if (e.shiftKey) return; if (ui.isOurs(e.target)) return; e.stopPropagation(); }
    function onAuxclick(e) { if (state.mode !== "on") return; if (e.shiftKey) return; if (ui.isOurs(e.target)) return; e.preventDefault(); e.stopPropagation(); }
    // The screenshot binding the boot snippet registers (Playwright's
    // exposeBinding). Absent on the fallback boot path, and then comments simply
    // carry no shot and the agent screenshots at processing time as before.
    var SHOT_WAIT_MS = 1500;
    function shoot() {
      if (typeof window.__annotatorShoot !== "function") return Promise.resolve(null);
      var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, SHOT_WAIT_MS); });
      var shot = window.__annotatorShoot().then(null, function () { return null; });
      return Promise.race([shot, giveUp]);
    }
    function onClick(e) {
      if (state.mode !== "on") return;
      if (e.shiftKey) return;                        // peek: let the app handle this click
      if (ui.isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      var el = e.target, x = e.clientX, y = e.clientY;
      if (e.metaKey || e.ctrlKey) { togglePick(el); return; }
      // Shot first, box second. The tooltip or open menu Matt is pointing at is on
      // screen NOW; the box would cover it, and processing time is far too late.
      // The highlight ring stays in the shot on purpose: it marks what was clicked.
      closeComment(); ui.hideInspector();
      shoot().then(function (shot) {
        if (state.mode !== "on") return;             // left the mode while the shot was taken
        openComment(el, x, y, shot);
      });
    }
    // Escape only matters while the comment box can be open, i.e. while enabled.
    // First Escape closes the box, the next one drops the picks.
    function onKeydown(e) {
      if (e.key !== "Escape") return;
      if (box) closeComment(); else if (picks.length) clearPicks();
    }

    var attached = false;
    function enable() {
      if (attached) return;
      attached = true;
      ui.setCrosshair(true);
      document.addEventListener("mousemove", onMousemove, true);
      document.addEventListener("pointerdown", blockNav, true);
      document.addEventListener("mousedown", blockNav, true);
      document.addEventListener("auxclick", onAuxclick, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeydown, true);
    }
    function disable() {
      if (!attached) return;
      attached = false;
      ui.setCrosshair(false);
      document.removeEventListener("mousemove", onMousemove, true);
      document.removeEventListener("pointerdown", blockNav, true);
      document.removeEventListener("mousedown", blockNav, true);
      document.removeEventListener("auxclick", onAuxclick, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      ui.hideHighlight(); ui.hideInspector(); closeComment(); clearPicks();
    }

    // Scroll a saved annotation's element into view. Selector first; if the DOM shifted
    // (client nav, re-render) fall back to matching the captured tag + text.
    function reveal(id) {
      var a = window.__annotations.find(function (x) { return x.id === id; }); if (!a) return false;
      var el = a.selector && document.querySelector(a.selector);
      if (!el && a.descriptor && a.descriptor.text) {
        var want = a.descriptor.text, tag = a.descriptor.tag || "*";
        el = Array.prototype.find.call(document.querySelectorAll(tag), function (n) { return (n.textContent || "").trim().slice(0, 120) === want; }) || null;
      }
      if (el) { el.scrollIntoView({ block: "center" }); return true; }
      return false;
    }

    return { enable: enable, disable: disable, reveal: reveal, takeImage: takeImage };
  }

  return { create: create };
});
