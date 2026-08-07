// Annotate overlay — chrome. Draws the highlight box, inspector card, and the
// bottom-right control bar, and exposes handles. It owns no mode state and no
// annotation state — index.js decides when to call what.
;(function (root, factory) {
  var palette = (typeof module !== "undefined" && module.exports) ? require("./palette.js") : (root.__annotatorMods && root.__annotatorMods.palette);
  var api = factory(palette);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.ui = api; }
})(typeof self !== "undefined" ? self : this, function (palette) {
  if (!palette) throw new Error("annotate: ui.js requires palette.js to load first");
  var SANS = palette.SANS;
  var MONO = palette.MONO;

  function create(pal) {
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
    // The "Click" row's own description is mode-dependent (comment / pin a
    // readout / passes through) — ui.js owns no mode state (see the guard
    // test below), so it only keeps a handle to the value span here; index.js
    // (which already owns the pill label) decides the actual text via
    // setClickHint().
    var clickHintEl = null;
    [
      [["Alt", "A"], "Toggle on / off"],
      [["Hover"], "Inspect element"],
      [["Click"], "Leave a comment"],
      [["⌘", "V"], "Paste/drop an image"],
      [["⌘/Ctrl", "↵"], "Save comment"],
      [["Shift"], "Hold to click through"],
      [["Esc"], "Cancel comment"]
    ].forEach(function (r) {
      var row = kbdRow(r[0], r[1]);
      guide.appendChild(row);
      if (r[0].length === 1 && r[0][0] === "Click") clickHintEl = row.lastChild;
    });
    bar.appendChild(guide);
    function setClickHint(text) { if (clickHintEl) clickHintEl.textContent = text; }

    var controls = document.createElement("div"); Object.assign(controls.style, { display: "flex", alignItems: "center", gap: "8px" });
    var help = document.createElement("button"); help.textContent = "?"; help.setAttribute("aria-label", "Toggle shortcut guide");
    Object.assign(help.style, { width: "28px", height: "28px", borderRadius: "999px", background: pal.surface2, color: pal.text2, border: "1px solid " + pal.border, font: "600 13px " + SANS, cursor: "pointer" });
    help.addEventListener("click", function () { guide.style.display = guide.style.display === "none" ? "block" : "none"; });
    var pill = document.createElement("div");
    Object.assign(pill.style, { padding: "7px 13px", borderRadius: "999px", font: "600 12px/1 " + SANS, cursor: "pointer", userSelect: "none", border: "1px solid " + pal.border, boxShadow: "0 2px 10px rgba(0,0,0,.28)" });
    controls.append(help, pill); bar.appendChild(controls);

    // Moved out of updatePill (overlay.js): index.js owns the mode/count text, this
    // just applies it to the DOM.
    function setPillLabel(text, background, color) {
      pill.textContent = text;
      pill.style.background = background;
      pill.style.color = color;
    }

    // ---- favourite panel: note + tags input, for Study mode's favourite
    // action. Created generically, same as everything else in this file — no
    // mode check lives here (see the guard test below); index.js decides when
    // it's shown via setFavouriteVisible(), exactly as it already decides
    // setClickHint()'s text.
    var favPanel = document.createElement("div"); favPanel.className = "__ann-ui";
    Object.assign(favPanel.style, { display: "none", flexDirection: "column", gap: "6px", width: "244px", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "12px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", padding: "10px 12px", font: "12px " + SANS });
    var favNote = document.createElement("input"); favNote.type = "text"; favNote.placeholder = "Note";
    var favTags = document.createElement("input"); favTags.type = "text"; favTags.placeholder = "Tags, comma separated";
    [favNote, favTags].forEach(function (inp) {
      Object.assign(inp.style, { font: "12px " + SANS, padding: "6px 8px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text });
    });
    var favBtn = document.createElement("button"); favBtn.textContent = "★ Save favourite";
    Object.assign(favBtn.style, { padding: "6px 10px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.accent, color: pal.accentFg, font: "600 12px " + SANS, cursor: "pointer" });
    favPanel.append(favNote, favTags, favBtn);
    bar.appendChild(favPanel);

    var favouriteHandler = null;
    function onFavouriteSave(fn) { favouriteHandler = fn; }
    favBtn.addEventListener("click", function () {
      if (favouriteHandler) favouriteHandler(favNote.value, favTags.value);
    });
    function setFavouriteVisible(v) { favPanel.style.display = v ? "flex" : "none"; }

    return {
      showHighlight: showHighlight,
      hideHighlight: hideHighlight,
      showInspector: showInspector,
      hideInspector: hideInspector,
      bar: bar,
      pill: pill,
      guide: guide,
      help: help,
      setPillLabel: setPillLabel,
      setClickHint: setClickHint,
      setFavouriteVisible: setFavouriteVisible,
      onFavouriteSave: onFavouriteSave,
      isOurs: isOurs
    };
  }

  return { create: create };
});
