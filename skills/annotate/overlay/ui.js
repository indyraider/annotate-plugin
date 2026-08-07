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

    // ---- bottom-CENTRE control bar: [guide] [queue] over the Layout B toolbar ----
    // Centred, not cornered: the toolbar is now two rows and wide enough that a
    // corner anchor puts it over whatever the page keeps in that corner.
    var bar = document.createElement("div"); bar.className = "__ann-ui";
    Object.assign(bar.style, { position: "fixed", bottom: "16px", left: "50%", transform: "translateX(-50%)", zIndex: Z, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", font: "12px/1.4 " + SANS });
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
      [["Alt"], "Click without navigating"],
      [["Shift"], "Hold to click through"],
      [["Esc"], "Cancel comment"]
    ].forEach(function (r) {
      var row = kbdRow(r[0], r[1]);
      guide.appendChild(row);
      if (r[0].length === 1 && r[0][0] === "Click") clickHintEl = row.lastChild;
    });
    // Starts hidden behind the ? button. With a labelled toolbar the shortcut
    // list is a reference, not an orientation aid, and it covered a chunk of
    // the page it was meant to help inspect.
    guide.style.display = "none";
    bar.appendChild(guide);
    function setClickHint(text) { if (clickHintEl) clickHintEl.textContent = text; }

    // The queue opens on demand rather than living permanently on screen —
    // the whole point of this overlay is that the page under it stays visible.
    // ui.js holds no annotation state (asserted); index.js hands it rows.
    var queuePanel = document.createElement("div");
    Object.assign(queuePanel.style, { display: "none", flexDirection: "column", gap: "4px", width: "300px", maxHeight: "260px", overflowY: "auto", background: pal.elevated, color: pal.text, border: "1px solid " + pal.border, borderRadius: "12px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", padding: "10px 12px", font: "12px/1.5 " + SANS });
    bar.appendChild(queuePanel);

    var queueBtn = document.createElement("button");
    queueBtn.setAttribute("aria-label", "Toggle the comment queue");
    queueBtn.setAttribute("data-ann-act", "queue");
    Object.assign(queueBtn.style, { padding: "6px 11px", borderRadius: "7px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text2, font: "600 12px/1 " + SANS, cursor: "pointer", whiteSpace: "nowrap" });
    function setQueueCount(n) { queueBtn.textContent = n ? "Queue " + n : "Queue"; }
    setQueueCount(0);
    // Rows are built from plain {n, text, status} — no annotation object, no
    // storage key, nothing this file could come to depend on.
    function setQueueItems(items, onPick) {
      queuePanel.textContent = "";
      if (!items || !items.length) {
        var empty = document.createElement("div");
        empty.textContent = "Nothing queued yet.";
        Object.assign(empty.style, { color: pal.text3, padding: "4px 0" });
        queuePanel.appendChild(empty);
        return;
      }
      items.forEach(function (it) {
        var row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "8px", alignItems: "baseline", padding: "4px 6px", borderRadius: "6px", cursor: onPick ? "pointer" : "default" });
        var badge = document.createElement("span");
        badge.textContent = it.n;
        Object.assign(badge.style, { flex: "none", minWidth: "18px", textAlign: "center", background: it.status === "new" ? pal.accent : pal.surface2, color: it.status === "new" ? pal.accentFg : pal.text3, borderRadius: "5px", font: "600 10px/1.7 " + MONO });
        var txt = document.createElement("span");
        txt.textContent = it.text;
        Object.assign(txt.style, { color: pal.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
        row.append(badge, txt);
        if (onPick) row.addEventListener("click", function () { onPick(it.id); });
        queuePanel.appendChild(row);
      });
    }

    var help = document.createElement("button"); help.textContent = "?"; help.setAttribute("aria-label", "Toggle shortcut guide");
    help.setAttribute("data-ann-act", "help");
    Object.assign(help.style, { width: "26px", height: "26px", flex: "none", borderRadius: "999px", background: pal.surface2, color: pal.text2, border: "1px solid " + pal.border, font: "600 13px " + SANS, cursor: "pointer", marginLeft: "2px" });

    // ---- one delegated CAPTURE listener for every control in this file ----
    //
    // Not a tidiness choice. Caught on linear.app: the very first click on a
    // toolbar button reached document-capture with the right target and then
    // never arrived at the button — the host page runs its own capture handler
    // and calls stopPropagation, which kills the descent before our chrome sees
    // anything. A per-button listener is downstream of that and simply loses.
    //
    // A listener on `document` in the capture phase is the earliest point we can
    // occupy, and stopPropagation from ANY listener at or below this node cannot
    // silence a listener already registered on the same node. Only
    // stopImmediatePropagation registered on document-capture before us beats
    // this, and nothing can defend against that.
    //
    // The failure it prevents is the whole tool: this toolbar is the only way in.
    var actions = {};
    var modeSelectHandler = null;
    function onAct(name, fn) { actions[name] = fn; }
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest("[data-ann-act],[data-ann-mode]");
      if (!hit || !isOurs(hit)) return;                 // never act on the host page's own markup
      var mode = hit.getAttribute("data-ann-mode");
      if (mode !== null) {
        if (hit.disabled) return;
        if (modeSelectHandler) modeSelectHandler(mode);
        return;
      }
      var act = actions[hit.getAttribute("data-ann-act")];
      if (act) act(hit);
    }, true);

    onAct("help", function () { guide.style.display = guide.style.display === "none" ? "block" : "none"; });
    onAct("queue", function () { queuePanel.style.display = queuePanel.style.display === "none" ? "flex" : "none"; });

    // ---- Layout B toolbar: a fixed row of modes over a row that swaps ----
    //
    //   ┌──────────────────────────────────────────┐
    //   │  Point  Measure  Compare  Study │ Queue  │  <- never changes
    //   ├──────────────────────────────────────────┤
    //   │  <tools for the selected mode>           │  <- swaps
    //   └──────────────────────────────────────────┘
    //
    // Chosen over one wide row (crowds the page at ~700px) and over a side panel
    // (taxes the width of the thing being reviewed). B is the only one that still
    // works at fifteen tools, and there will be fifteen.
    //
    // ui.js does not know what a mode IS. index.js hands it a list of
    // {key, label} and a callback; this file only draws buttons and marks one
    // active. That is what keeps the "ui.js never branches on mode" invariant
    // true by construction rather than by discipline.
    var toolbar = document.createElement("div");
    Object.assign(toolbar.style, { display: "flex", flexDirection: "column", background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "12px", boxShadow: "0 10px 34px rgba(0,0,0,.42)", overflow: "hidden" });

    var row1 = document.createElement("div");
    Object.assign(row1.style, { display: "flex", alignItems: "center", gap: "2px", padding: "5px 6px" });
    var row2 = document.createElement("div");
    Object.assign(row2.style, { display: "none", borderTop: "1px solid " + pal.hairline, padding: "8px 10px" });
    toolbar.append(row1, row2);
    bar.appendChild(toolbar);

    function tabStyle(btn, active, disabled) {
      Object.assign(btn.style, {
        padding: "6px 11px", borderRadius: "7px", border: "1px solid transparent",
        font: "600 12px/1 " + SANS, cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none", whiteSpace: "nowrap",
        background: active ? pal.accent : "transparent",
        color: disabled ? pal.text3 : (active ? pal.accentFg : pal.text2),
        opacity: disabled ? "0.5" : "1"
      });
    }

    var modeButtons = {};
    var activeMode = null;
    function setModes(items, onSelect) {
      row1.textContent = "";
      modeButtons = {};
      modeSelectHandler = onSelect;
      items.forEach(function (item) {
        var b = document.createElement("button");
        b.textContent = item.label;
        b.setAttribute("data-ann-mode", item.key);
        if (item.title) b.title = item.title;
        b.disabled = !!item.disabled;
        tabStyle(b, false, item.disabled);
        modeButtons[item.key] = { el: b, disabled: !!item.disabled };
        row1.appendChild(b);
      });
      // The queue sits after a divider — it is not a mode, and a user who
      // reads it as a fifth mode will expect selecting it to change what
      // clicking the page does.
      var div = document.createElement("span");
      Object.assign(div.style, { width: "1px", alignSelf: "stretch", background: pal.hairline, margin: "2px 6px" });
      row1.append(div, queueBtn, help);
      if (activeMode) setActiveMode(activeMode);
    }
    function setActiveMode(key) {
      activeMode = key;
      for (var k in modeButtons) {
        if (!Object.prototype.hasOwnProperty.call(modeButtons, k)) continue;
        tabStyle(modeButtons[k].el, k === key, modeButtons[k].disabled);
      }
    }

    // Row 2's contents belong to whoever owns mode state, which is not this
    // file. Passing null collapses the row rather than leaving an empty strip
    // of chrome sitting over the page being studied.
    function setModeTools(node) {
      row2.textContent = "";
      if (!node) { row2.style.display = "none"; return; }
      row2.appendChild(node);
      row2.style.display = "block";
    }

    // ---- favourite panel: note + tags input, for Study mode's favourite
    // action. Created generically, same as everything else in this file — no
    // mode check lives here (see the guard test below); index.js decides when
    // it goes into row 2 via setModeTools(), exactly as index.js already decides
    // setClickHint()'s text.
    var favPanel = document.createElement("div"); favPanel.className = "__ann-ui";
    Object.assign(favPanel.style, { display: "flex", flexDirection: "column", gap: "6px", width: "280px", font: "12px " + SANS });
    var favNote = document.createElement("input"); favNote.type = "text"; favNote.placeholder = "Note";
    var favTags = document.createElement("input"); favTags.type = "text"; favTags.placeholder = "Tags, comma separated";
    [favNote, favTags].forEach(function (inp) {
      Object.assign(inp.style, { font: "12px " + SANS, padding: "6px 8px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text });
    });
    var favBtn = document.createElement("button"); favBtn.textContent = "★ Save favourite";
    favBtn.setAttribute("data-ann-act", "fav-save");
    Object.assign(favBtn.style, { padding: "6px 10px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.accent, color: pal.accentFg, font: "600 12px " + SANS, cursor: "pointer" });
    // Pressing ★ used to change nothing on screen whether it worked or not —
    // reported live as "nothing happens when i click save favourite". A control
    // whose entire output is invisible state is indistinguishable from a broken
    // one, and the user is right to call it broken.
    var favStatus = document.createElement("div");
    Object.assign(favStatus.style, { color: pal.text3, font: "11px " + SANS, minHeight: "14px" });
    function setFavouriteStatus(text, ok) {
      favStatus.textContent = text || "";
      favStatus.style.color = text ? (ok ? pal.text2 : pal.accent) : pal.text3;
    }
    favPanel.append(favNote, favTags, favBtn, favStatus);
    // NOT appended anywhere here — it is one of the things index.js can hand to
    // setModeTools(), and only index.js knows which mode wants it.

    var favouriteHandler = null;
    function onFavouriteSave(fn) { favouriteHandler = fn; }
    onAct("fav-save", function () {
      if (favouriteHandler) favouriteHandler(favNote.value, favTags.value);
    });

    // ---- compare panel: save a baseline, then diff a re-run against it ----
    // Built generically like everything else here. index.js owns what the
    // buttons MEAN; this file owns only that they exist and are clickable.
    var comparePanel = document.createElement("div"); comparePanel.className = "__ann-ui";
    Object.assign(comparePanel.style, { display: "flex", flexDirection: "column", gap: "8px", width: "430px", font: "12px " + SANS });
    var cmpBar = document.createElement("div");
    Object.assign(cmpBar.style, { display: "flex", alignItems: "center", gap: "8px" });
    function cmpButton(act, label) {
      var b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("data-ann-act", act);
      Object.assign(b.style, { padding: "6px 10px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text, font: "600 12px " + SANS, cursor: "pointer", whiteSpace: "nowrap" });
      return b;
    }
    var cmpSave = cmpButton("cmp-save", "Save baseline");
    var cmpRun = cmpButton("cmp-run", "Compare");
    var cmpFilterLabel = document.createElement("label");
    Object.assign(cmpFilterLabel.style, { display: "flex", alignItems: "center", gap: "5px", color: pal.text2, cursor: "pointer", marginLeft: "auto", whiteSpace: "nowrap" });
    var cmpFilter = document.createElement("input");
    cmpFilter.type = "checkbox";
    cmpFilter.setAttribute("data-ann-act", "cmp-filter");
    var cmpFilterText = document.createElement("span"); cmpFilterText.textContent = "regressions only";
    cmpFilterLabel.append(cmpFilter, cmpFilterText);
    cmpBar.append(cmpSave, cmpRun, cmpFilterLabel);
    var cmpStatus = document.createElement("div");
    Object.assign(cmpStatus.style, { color: pal.text3, font: "11px " + SANS });
    var cmpRows = document.createElement("div");
    Object.assign(cmpRows.style, { display: "none", flexDirection: "column", gap: "2px", maxHeight: "190px", overflowY: "auto" });
    comparePanel.append(cmpBar, cmpStatus, cmpRows);

    function setCompareStatus(text) { cmpStatus.textContent = text || ""; }
    function isRegressionsOnly() { return !!cmpFilter.checked; }
    // Rows arrive as plain {label, detail, tone} — no verdict enum, no delta
    // maths, nothing this file could come to depend on.
    function setCompareRows(rows) {
      cmpRows.textContent = "";
      if (!rows || !rows.length) { cmpRows.style.display = "none"; return; }
      var TONE = { bad: "#ff6f5e", good: "#3fbf7f", flat: pal.text3 };
      rows.forEach(function (r) {
        var row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "10px", alignItems: "baseline", padding: "3px 6px", borderRadius: "5px", background: pal.surface2 });
        var d = document.createElement("span");
        d.textContent = r.detail;
        Object.assign(d.style, { flex: "none", minWidth: "112px", color: TONE[r.tone] || pal.text2, font: "600 11px " + MONO });
        var l = document.createElement("span");
        l.textContent = r.label;
        Object.assign(l.style, { color: pal.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
        row.append(d, l);
        cmpRows.appendChild(row);
      });
      cmpRows.style.display = "flex";
    }

    // A plain line of text for a mode whose row 2 is just a status ("Passes
    // through (recording) · 41 entries"). Saves index.js hand-building a node.
    function toolsText(text) {
      var d = document.createElement("div");
      d.textContent = text;
      Object.assign(d.style, { color: pal.text2, font: "12px " + SANS });
      return d;
    }

    return {
      showHighlight: showHighlight,
      hideHighlight: hideHighlight,
      showInspector: showInspector,
      hideInspector: hideInspector,
      bar: bar,
      toolbar: toolbar,
      guide: guide,
      help: help,
      setModes: setModes,
      setActiveMode: setActiveMode,
      setModeTools: setModeTools,
      toolsText: toolsText,
      favPanel: favPanel,
      setFavouriteStatus: setFavouriteStatus,
      clearFavouriteInputs: function () { favNote.value = ""; favTags.value = ""; },
      comparePanel: comparePanel,
      setCompareStatus: setCompareStatus,
      setCompareRows: setCompareRows,
      isRegressionsOnly: isRegressionsOnly,
      onAct: onAct,
      setQueueCount: setQueueCount,
      setQueueItems: setQueueItems,
      queuePanel: queuePanel,
      setClickHint: setClickHint,
      onFavouriteSave: onFavouriteSave,
      isOurs: isOurs
    };
  }

  return { create: create };
});
