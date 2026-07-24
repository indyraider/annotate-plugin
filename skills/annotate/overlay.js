// Annotate overlay — injected into the live app by the /annotate skill.
// Dev tool only; never shipped. UMD tail so the same file both (a) auto-runs
// when injected into the browser and (b) exports buildSelector for the Node
// self-check without touching window/document.
//
// Theming: the overlay reads the HOST page's own background + text colors at
// runtime (getComputedStyle) and derives its whole palette from them, so it
// blends into whatever app it's injected into — light or dark — instead of a
// hardcoded look. One fixed ACCENT is the tool's own identity (change below).
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node: export, do NOT run
  else { root.__annotatorApi = api; api.__setupAnnotator(); }                 // Browser: run
})(typeof self !== "undefined" ? self : this, function () {

  // Pure: element -> stable CSS selector. No globals except guarded CSS.escape.
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    var esc = function (s) { return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(s) : s; };
    if (el.id) return "#" + esc(el.id);
    var parts = [], node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var tag = node.tagName.toLowerCase();
      if (tag === "body" || tag === "html") break;
      if (node.id) { parts.unshift("#" + esc(node.id)); break; }
      var part = tag, parent = node.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function __setupAnnotator() {
    if (window.__annotator) return;                 // idempotent re-inject guard
    window.__annotator = { mode: "off" };
    var KEY = "__annotations";
    var SANS = "system-ui, -apple-system, Segoe UI, sans-serif";
    var MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
    var persist = function () { try { localStorage.setItem(KEY, JSON.stringify(window.__annotations)); } catch (e) {} };
    window.__annotations = load();
    var seq = window.__annotations.reduce(function (m, a) { return Math.max(m, a.n || 0); }, 0);
    var waiter = null; // { resolve, timer } — one-shot long-poll resolver

    // ---- adaptive palette derived from the host page ----
    // ACCENT is the tool's own signature color (the one thing that stays constant
    // across apps). Everything else is mixed from the page's real bg/text.
    var ACCENT = "#ff6f5e", ACCENT_FG = "#1c1206";
    var mix = function (base, other, pct) { return "color-mix(in srgb, " + base + ", " + other + " " + pct + "%)"; };
    var pal = (function () {
      var pick = function (cs, prop, fallback) { var c = cs && cs[prop]; return (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") ? fallback : c; };
      var b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
      var bg = pick(b, "backgroundColor", pick(h, "backgroundColor", "rgb(24,24,27)"));
      var text = pick(b, "color", pick(h, "color", "rgb(237,237,237)"));
      // Robust luminance via canvas — resolves any CSS color format (rgb/hex/named/lab/oklch)
      // to real sRGB bytes. String-parsing misreads modern lab()/oklch() channel ranges.
      var lum = 0.11;
      try { var cv = document.createElement("canvas"); cv.width = cv.height = 1; var ctx = cv.getContext("2d"); ctx.fillStyle = "#808080"; ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1); var px = ctx.getImageData(0, 0, 1, 1).data; lum = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255; } catch (e) {}
      var up = lum < 0.5 ? "white" : "black"; // lift surfaces toward this
      return {
        elevated: mix(bg, up, 8), surface: mix(bg, up, 3), surface2: mix(bg, up, 14), hover: mix(bg, up, 20),
        border: mix(text, "transparent", 80), hairline: mix(text, "transparent", 90),
        text: text, text2: mix(text, "transparent", 32), text3: mix(text, "transparent", 52),
        accent: ACCENT, accentFg: ACCENT_FG, accentSoft: "color-mix(in srgb, " + ACCENT + " 14%, transparent)"
      };
    })();

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

    // ---- UI ----
    var isOurs = function (t) { return t && t.closest && t.closest(".__ann-ui"); };
    var Z = 2147483647;

    // Crosshair cursor over the whole app while ON (our own UI keeps its normal cursors).
    var cursorStyle = document.createElement("style"); cursorStyle.className = "__ann-ui";
    cursorStyle.textContent = "html.__ann-cross, html.__ann-cross :not(.__ann-ui):not(.__ann-ui *){cursor:crosshair !important}";
    document.head.appendChild(cursorStyle);

    var hl = document.createElement("div"); hl.className = "__ann-ui";
    Object.assign(hl.style, { position: "fixed", zIndex: Z - 1, pointerEvents: "none", border: "1.5px solid " + pal.accent, background: pal.accentSoft, display: "none", borderRadius: "5px" });
    document.body.appendChild(hl);
    function showHighlight(el) { var r = el.getBoundingClientRect(); Object.assign(hl.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" }); }
    function hideHighlight() { hl.style.display = "none"; }

    // Inspector card — DevTools-style computed-style readout that follows the cursor.
    var insp = document.createElement("div"); insp.className = "__ann-ui";
    Object.assign(insp.style, { position: "fixed", zIndex: Z, display: "none", maxWidth: "300px", pointerEvents: "none", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "8px", padding: "8px 10px", font: "11px/1.55 " + MONO, color: pal.text, boxShadow: "0 8px 30px rgba(0,0,0,.4)" });
    document.body.appendChild(insp);
    function inspRow(label, value, swatch) {
      var d = document.createElement("div"); Object.assign(d.style, { display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", overflow: "hidden" });
      if (swatch) { var s = document.createElement("span"); s.style.cssText = "width:9px;height:9px;border-radius:2px;flex:none"; s.style.border = "1px solid " + pal.hairline; s.style.background = swatch; d.appendChild(s); }
      if (label) { var k = document.createElement("span"); k.textContent = label; Object.assign(k.style, { color: pal.text3, flex: "none", minWidth: "42px" }); d.appendChild(k); }
      var v = document.createElement("span"); v.textContent = value; Object.assign(v.style, { color: label ? pal.text : pal.accent, fontWeight: label ? "400" : "600", overflow: "hidden", textOverflow: "ellipsis" }); d.appendChild(v);
      return d;
    }
    function showInspector(el, x, y) {
      if (box) { hideInspector(); return; }          // don't cover the open comment box
      var cs = getComputedStyle(el), r = el.getBoundingClientRect();
      var cls = (typeof el.className === "string" && el.className.trim()) ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      insp.textContent = "";
      insp.appendChild(inspRow(null, el.tagName.toLowerCase() + cls, null));
      insp.appendChild(inspRow("size", Math.round(r.width) + " × " + Math.round(r.height) + " px", null));
      insp.appendChild(inspRow("font", cs.fontSize + " / " + cs.lineHeight + "  " + cs.fontFamily.split(",")[0].replace(/["']/g, ""), null));
      insp.appendChild(inspRow("weight", cs.fontWeight, null));
      insp.appendChild(inspRow("color", cs.color, cs.color));
      insp.appendChild(inspRow("bg", cs.backgroundColor, cs.backgroundColor));
      insp.appendChild(inspRow("pad", cs.paddingTop + " " + cs.paddingRight + " " + cs.paddingBottom + " " + cs.paddingLeft, null));
      insp.appendChild(inspRow("margin", cs.marginTop + " " + cs.marginRight + " " + cs.marginBottom + " " + cs.marginLeft, null));
      insp.style.display = "block";
      insp.style.left = Math.min(x + 14, window.innerWidth - insp.offsetWidth - 8) + "px";
      insp.style.top = Math.min(y + 14, window.innerHeight - insp.offsetHeight - 8) + "px";
    }
    function hideInspector() { insp.style.display = "none"; }

    // ---- bottom-right control bar: [guide panel] over [ ? ] [ pill ] ----
    var bar = document.createElement("div"); bar.className = "__ann-ui";
    Object.assign(bar.style, { position: "fixed", bottom: "16px", right: "16px", zIndex: Z, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", font: "12px/1.4 " + SANS });
    document.body.appendChild(bar);

    var guide = document.createElement("div");
    Object.assign(guide.style, { width: "244px", background: pal.elevated, color: pal.text, border: "1px solid " + pal.border, borderRadius: "12px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", padding: "12px 14px" });
    var gHead = document.createElement("div"); Object.assign(gHead.style, { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" });
    var gTitle = document.createElement("div"); gTitle.textContent = "Annotate"; Object.assign(gTitle.style, { font: "600 13px " + SANS, color: pal.text });
    var gSub = document.createElement("div"); gSub.textContent = "point · comment · fix"; Object.assign(gSub.style, { font: "11px " + SANS, color: pal.text3 });
    gHead.append(gTitle, gSub); guide.appendChild(gHead);
    function kbdRow(keys, desc) {
      var d = document.createElement("div"); Object.assign(d.style, { display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" });
      var kw = document.createElement("div"); Object.assign(kw.style, { display: "flex", gap: "3px", flex: "none", minWidth: "92px" });
      keys.forEach(function (k) { var kb = document.createElement("span"); kb.textContent = k; Object.assign(kb.style, { background: pal.surface2, border: "1px solid " + pal.border, borderRadius: "4px", padding: "1px 5px", font: "600 10px/1.6 " + MONO, color: pal.text2 }); kw.appendChild(kb); });
      var t = document.createElement("span"); t.textContent = desc; t.style.color = pal.text2;
      d.append(kw, t); return d;
    }
    [
      [["Alt", "A"], "Toggle on / off"],
      [["Hover"], "Inspect element"],
      [["Click"], "Leave a comment"],
      [["⌘/Ctrl", "↵"], "Save comment"],
      [["Shift"], "Hold to click through"],
      [["Esc"], "Cancel comment"]
    ].forEach(function (r) { guide.appendChild(kbdRow(r[0], r[1])); });
    bar.appendChild(guide);

    var controls = document.createElement("div"); Object.assign(controls.style, { display: "flex", alignItems: "center", gap: "8px" });
    var help = document.createElement("button"); help.textContent = "?"; help.setAttribute("aria-label", "Toggle shortcut guide");
    Object.assign(help.style, { width: "28px", height: "28px", borderRadius: "999px", background: pal.surface2, color: pal.text2, border: "1px solid " + pal.border, font: "600 13px " + SANS, cursor: "pointer" });
    help.addEventListener("click", function () { guide.style.display = guide.style.display === "none" ? "block" : "none"; });
    var pill = document.createElement("div");
    Object.assign(pill.style, { padding: "7px 13px", borderRadius: "999px", font: "600 12px/1 " + SANS, cursor: "pointer", userSelect: "none", border: "1px solid " + pal.border, boxShadow: "0 2px 10px rgba(0,0,0,.28)" });
    pill.addEventListener("click", toggle);
    controls.append(help, pill); bar.appendChild(controls);
    function updatePill() {
      var on = window.__annotator.mode === "on", c = window.__annotations.length;
      pill.textContent = (on ? "● Annotate: ON" : "○ Annotate: OFF") + (c ? " · " + c : "");
      pill.style.background = on ? pal.accent : pal.surface2;
      pill.style.color = on ? pal.accentFg : pal.text2;
    }
    function toggle() { window.__annotator.mode = window.__annotator.mode === "on" ? "off" : "on"; var on = window.__annotator.mode === "on"; document.documentElement.classList.toggle("__ann-cross", on); if (!on) { hideHighlight(); hideInspector(); } updatePill(); }

    function btn(label, primary) { var b = document.createElement("button"); b.textContent = label; Object.assign(b.style, { background: primary ? pal.accent : pal.hover, color: primary ? pal.accentFg : pal.text, border: primary ? "none" : "1px solid " + pal.border, borderRadius: "6px", padding: "5px 10px", font: "600 12px " + SANS, cursor: "pointer" }); return b; }
    var box = null, target = null;
    function openComment(el, x, y) {
      closeComment(); target = el;
      box = document.createElement("div"); box.className = "__ann-ui";
      Object.assign(box.style, { position: "fixed", left: Math.min(x, window.innerWidth - 260) + "px", top: Math.min(y, window.innerHeight - 150) + "px", zIndex: Z, width: "244px", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "8px", padding: "8px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", font: "12px " + SANS, color: pal.text });
      var ta = document.createElement("textarea"); ta.placeholder = "What should change here?  (⌘/Ctrl+Enter to save)";
      Object.assign(ta.style, { width: "100%", height: "66px", resize: "none", background: pal.surface, color: pal.text, border: "1px solid " + pal.border, borderRadius: "6px", padding: "6px", font: "12px " + SANS, boxSizing: "border-box", outline: "none" });
      ta.addEventListener("focus", function () { ta.style.borderColor = pal.accent; });
      ta.addEventListener("blur", function () { ta.style.borderColor = pal.border; });
      var row = document.createElement("div"); Object.assign(row.style, { display: "flex", gap: "6px", marginTop: "6px", justifyContent: "flex-end" });
      var cancel = btn("Cancel", false), saveBtn = btn("Save", true);
      var submit = function () { var v = ta.value.trim(); if (v) record(target, v); closeComment(); };
      cancel.onclick = closeComment; saveBtn.onclick = submit;
      ta.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } });
      row.append(cancel, saveBtn); box.append(ta, row); document.body.appendChild(box); ta.focus();
    }
    function closeComment() { if (box) { box.remove(); box = null; target = null; } }

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

    function record(el, comment) {
      seq += 1;
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el), comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "new" };
      window.__annotations.push(a); persist(); addBadge(el, seq); updatePill();
      if (waiter) { var w = waiter; waiter = null; clearTimeout(w.timer); w.resolve(); }  // wake the long-poll
    }

    // ---- events (capture phase; only act in ON mode; never swallow our own UI) ----
    // Hold Shift = "peek": every handler bails, so the app behaves normally for one
    // interaction (open a dropdown/modal) without leaving annotate mode.
    document.addEventListener("mousemove", function (e) {
      if (window.__annotator.mode !== "on") return;
      if (e.shiftKey || isOurs(e.target)) { hideHighlight(); hideInspector(); return; }
      showHighlight(e.target);
      showInspector(e.target, e.clientX, e.clientY);
    }, true);
    // While ON, kill every nav vector on non-our elements so a click can't navigate:
    // SPA handlers fire on pointerdown/mousedown (stopPropagation keeps them from running),
    // native <a> nav + middle-click fire on click/auxclick (preventDefault). Click then opens the box.
    var blockNav = function (e) { if (window.__annotator.mode !== "on") return; if (e.shiftKey) return; if (isOurs(e.target)) return; e.stopPropagation(); };
    document.addEventListener("pointerdown", blockNav, true);
    document.addEventListener("mousedown", blockNav, true);
    document.addEventListener("auxclick", function (e) { if (window.__annotator.mode !== "on") return; if (e.shiftKey) return; if (isOurs(e.target)) return; e.preventDefault(); e.stopPropagation(); }, true);
    document.addEventListener("click", function (e) {
      if (window.__annotator.mode !== "on") return;
      if (e.shiftKey) return;                        // peek: let the app handle this click
      if (isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      hideInspector();
      openComment(e.target, e.clientX, e.clientY);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggle(); }
      else if (e.key === "Escape" && box) closeComment();
    }, true);

    // ---- long-poll API for the skill's watch loop ----
    window.__annotatorDrain = function () { var f = window.__annotations.filter(function (a) { return a.status === "new"; }); f.forEach(function (a) { a.status = "seen"; }); persist(); return f; };
    window.__annotatorWait = function (timeoutMs) {
      return new Promise(function (resolve) {
        if (window.__annotations.some(function (a) { return a.status === "new"; })) return resolve(window.__annotatorDrain());
        if (waiter) { clearTimeout(waiter.timer); waiter.resolve(); }               // supersede a stale waiter
        var timer = setTimeout(function () { waiter = null; resolve([]); }, timeoutMs || 25000);
        waiter = { timer: timer, resolve: function () { resolve(window.__annotatorDrain()); } };
      });
    };
    // Scroll a saved annotation's element into view. Selector first; if the DOM shifted
    // (client nav, re-render) fall back to matching the captured tag + text.
    window.__annotatorReveal = function (id) {
      var a = window.__annotations.find(function (x) { return x.id === id; }); if (!a) return false;
      var el = a.selector && document.querySelector(a.selector);
      if (!el && a.descriptor && a.descriptor.text) {
        var want = a.descriptor.text, tag = a.descriptor.tag || "*";
        el = Array.prototype.find.call(document.querySelectorAll(tag), function (n) { return (n.textContent || "").trim().slice(0, 120) === want; }) || null;
      }
      if (el) { el.scrollIntoView({ block: "center" }); return true; }
      return false;
    };

    // Reload-proof: cache a self-contained bootstrap in localStorage (survives reloads).
    // The skill's watch loop re-runs this via (0,eval) when window.__annotator is missing,
    // so a page refresh never needs the full overlay re-pasted. buildSelector is prepended
    // because __setupAnnotator closes over it. ponytail: eval of our own source, dev-only.
    try { localStorage.setItem("__ann_boot", buildSelector.toString() + "\n(" + __setupAnnotator.toString() + ")();"); } catch (e) {}

    updatePill();
    console.log("[annotate] overlay ready — Alt+A toggle · hover = inspect · Shift = click-through · ? = shortcuts");
  }

  return { buildSelector: buildSelector, __setupAnnotator: __setupAnnotator };
});
