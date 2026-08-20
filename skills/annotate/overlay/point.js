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

  // ctx = { pal, ui, state, save, persist, notify } — see index.js (Task 5).
  function create(ctx) {
    var pal = ctx.pal, ui = ctx.ui, state = ctx.state, save = ctx.save, persist = ctx.persist, notify = ctx.notify;
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

    function describe(el) {
      var attrs = {};
      var list = el.attributes || [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i].name;
        if (n.indexOf("data-") === 0 || n === "aria-label" || n === "role" || n === "name") attrs[n] = list[i].value;
      }
      var src = null;
      try {
        var k = Object.keys(el).find(function (x) { return x.indexOf("__reactFiber$") === 0 || x.indexOf("__reactInternalInstance$") === 0; });
        var fiber = k ? el[k] : null;
        for (var j = 0; fiber && j < 6 && !src; j++) { if (fiber._debugSource) src = fiber._debugSource; fiber = fiber.return; }
      } catch (e) {}
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : "",
        id: el.id || null,
        className: (typeof el.className === "string" ? el.className : "") || null,
        text: (el.textContent || "").trim().slice(0, 120) || null,
        attrs: attrs,
        source: src ? { file: src.fileName, line: src.lineNumber } : null
      };
    }

    // ---- comment box, badge, paste/drop ----
    function btn(label, primary) { var b = document.createElement("button"); b.textContent = label; Object.assign(b.style, { background: primary ? pal.accent : pal.hover, color: primary ? pal.accentFg : pal.text, border: primary ? "none" : "1px solid " + pal.border, borderRadius: "6px", padding: "5px 10px", font: "600 12px " + SANS, cursor: "pointer" }); return b; }
    var box = null, target = null, pendingImage = null;
    function openComment(el, x, y) {
      closeComment(); target = el;
      box = document.createElement("div"); box.className = "__ann-ui";
      Object.assign(box.style, { position: "fixed", left: Math.min(x, window.innerWidth - 260) + "px", top: Math.min(y, window.innerHeight - 150) + "px", zIndex: Z, width: "244px", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "8px", padding: "8px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", font: "12px " + SANS, color: pal.text });
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
      var submit = function () { var v = ta.value.trim(); if (v) record(target, v, pendingImage); closeComment(); };
      cancel.onclick = closeComment; saveBtn.onclick = submit;
      ta.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } });
      row.append(hint, cancel, saveBtn);
      box.append(ta, thumbWrap, row); document.body.appendChild(box); ta.focus();
    }
    function closeComment() { if (box) { box.remove(); box = null; target = null; pendingImage = null; } }

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

    // seq lives here, not in index.js: no other mode assigns annotation ids.
    var seq = window.__annotations.reduce(function (m, a) { return Math.max(m, a.n || 0); }, 0);
    function record(el, comment, image) {
      seq += 1;
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el), comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "new", hasImage: !!image };
      // The image never rides along in the annotation — the agent pulls it by id.
      if (image) putImage(a.id, image);
      save(a); persist(); addBadge(el, seq); notify();
    }

    // ---- events (capture phase; only act in ON mode; never swallow our own UI) ----
    // Hold Shift = "peek": every handler bails, so the app behaves normally for one
    // interaction (open a dropdown/modal) without leaving annotate mode.
    function onMousemove(e) {
      if (state.mode !== "on") return;
      if (e.shiftKey || ui.isOurs(e.target)) { ui.hideHighlight(); ui.hideInspector(); return; }
      if (box) { ui.showHighlight(e.target); ui.hideInspector(); return; }  // keep tracking, don't cover the open comment box
      ui.showHighlight(e.target);
      ui.showInspector(e.target, e.clientX, e.clientY);
    }
    // While ON, kill every nav vector on non-our elements so a click can't navigate:
    // SPA handlers fire on pointerdown/mousedown (stopPropagation keeps them from running),
    // native <a> nav + middle-click fire on click/auxclick (preventDefault). Click then opens the box.
    function blockNav(e) { if (state.mode !== "on") return; if (e.shiftKey) return; if (ui.isOurs(e.target)) return; e.stopPropagation(); }
    function onAuxclick(e) { if (state.mode !== "on") return; if (e.shiftKey) return; if (ui.isOurs(e.target)) return; e.preventDefault(); e.stopPropagation(); }
    function onClick(e) {
      if (state.mode !== "on") return;
      if (e.shiftKey) return;                        // peek: let the app handle this click
      if (ui.isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      ui.hideInspector();
      openComment(e.target, e.clientX, e.clientY);
    }
    // Escape only matters while the comment box can be open, i.e. while enabled.
    function onKeydown(e) { if (e.key === "Escape" && box) closeComment(); }

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
      ui.hideHighlight(); ui.hideInspector(); closeComment();
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
