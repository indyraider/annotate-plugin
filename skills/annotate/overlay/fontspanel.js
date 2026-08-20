// Annotate overlay — the Fonts panel. One card per font the page uses; the
// expanded card carries the whole typographic suite: case, size, leading,
// tracking, word spacing, weight, italic, small caps.
//
// Split out of ui.js when the suite landed. ui.js is the overlay's chrome —
// highlight, inspector, toolbar, queue — and one mode's control surface had
// grown larger than all of that together.
//
// Owns no font knowledge. Cards arrive as plain rows and every control reports
// back three primitives (which card, which setting, what value). What a
// "setting" MEANS is fonts.js's business, and what it is called on screen is
// this file's.
;(function (root, factory) {
  var palette = (typeof module !== "undefined" && module.exports) ? require("./palette.js") : (root.__annotatorMods && root.__annotatorMods.palette);
  var api = factory(palette);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.fontspanel = api; }
})(typeof self !== "undefined" ? self : this, function (palette) {
  if (!palette) throw new Error("annotate: fontspanel.js requires palette.js to load first");
  var SANS = palette.SANS;

  // Words, not glyphs. "Aa" for original and "Aa" for title case are the same
  // two characters, and a control whose options cannot be told apart is not a
  // control. Kept short enough for four across a 300px row.
  var CASES = [
    { key: "", label: "Original" },
    { key: "uppercase", label: "UPPER" },
    { key: "lowercase", label: "lower" },
    { key: "capitalize", label: "Title" }
  ];

  // Each slider's range, step, and how its number reads. `unit` is display only
  // — fonts.js decides the CSS unit.
  var SLIDERS = [
    { key: "sizeScale",   label: "Size",       min: 0.5,   max: 2.0, step: 0.01,  fmt: function (v) { return v.toFixed(2) + "×"; } },
    { key: "lineHeight",  label: "Leading",    min: 0.8,   max: 2.6, step: 0.01,  fmt: function (v) { return v.toFixed(2); } },
    { key: "tracking",    label: "Tracking",   min: -0.08, max: 0.4, step: 0.002, fmt: function (v) { return (v > 0 ? "+" : "") + v.toFixed(3) + "em"; } },
    { key: "wordSpacing", label: "Word space", min: -0.1,  max: 0.8, step: 0.01,  fmt: function (v) { return (v > 0 ? "+" : "") + v.toFixed(2) + "em"; } }
  ];

  var TOGGLES = [
    { key: "italic", label: "Italic" },
    { key: "smallCaps", label: "Small caps" }
  ];

  function create(pal, picker, opts) {
    opts = opts || {};
    var handlers = { pickFont: null, style: null, clearStyles: null, remove: null, reset: null };
    var expandedId = null;
    var catalogue = [], previewLoader = null, catalogueNote = "";

    var el = document.createElement("div"); el.className = "__ann-ui";
    Object.assign(el.style, { display: "flex", flexDirection: "column", gap: "9px", width: "470px", font: "12px " + SANS });

    var head = document.createElement("div");
    Object.assign(head.style, { display: "flex", alignItems: "center", gap: "10px" });
    var status = document.createElement("div");
    Object.assign(status.style, { color: pal.text3, font: "11px/1.45 " + SANS, flex: "1", minWidth: "0" });
    var resetAll = document.createElement("button"); resetAll.textContent = "Reset";
    resetAll.setAttribute("data-ann-act", "fonts-reset");
    resetAll.title = "Put every element back to the type the page gave it";
    Object.assign(resetAll.style, { padding: "5px 11px", borderRadius: "7px", border: "1px solid " + pal.border, background: "transparent", color: pal.text2, font: "600 11px " + SANS, cursor: "pointer", flex: "none" });
    head.append(status, resetAll);

    var cards = document.createElement("div");
    Object.assign(cards.style, { display: "flex", flexDirection: "column", gap: "7px", maxHeight: "330px", overflowY: "auto" });
    el.append(head, cards);

    function setStatus(text) { status.textContent = text || ""; }
    function setOptions(items, onNeedPreview, note) {
      catalogue = items || [];
      previewLoader = onNeedPreview || null;
      catalogueNote = note || "";
      picker.setNote(catalogueNote);
      picker.refresh();
    }

    // ---- small builders, so the control grid below reads as layout ----
    function label(text) {
      var d = document.createElement("span");
      d.textContent = text;
      Object.assign(d.style, { flex: "none", width: "76px", color: pal.text3, font: "11px " + SANS });
      return d;
    }
    function ghostButton(text, act, id, title) {
      var b = document.createElement("button");
      b.textContent = text;
      b.setAttribute("data-ann-act", act);
      b.setAttribute("data-ann-slot", id);
      if (title) { b.title = title; b.setAttribute("aria-label", title); }
      Object.assign(b.style, { flex: "none", borderRadius: "6px", border: "1px solid " + pal.border, background: "transparent", color: pal.text3, font: "11px " + SANS, cursor: "pointer", padding: "3px 7px" });
      return b;
    }

    // ---- the expanded card's control grid ----
    function typography(r) {
      var box = document.createElement("div");
      Object.assign(box.style, { display: "flex", flexDirection: "column", gap: "7px", marginTop: "3px", paddingTop: "9px", borderTop: "1px solid " + pal.hairline });

      // Case — a segmented control, because the four options are one choice.
      var caseRow = document.createElement("div");
      Object.assign(caseRow.style, { display: "flex", alignItems: "center", gap: "8px" });
      var seg = document.createElement("div");
      Object.assign(seg.style, { display: "flex", gap: "2px", flex: "1", background: pal.elevated, borderRadius: "7px", padding: "2px", border: "1px solid " + pal.border });
      CASES.forEach(function (c) {
        var b = document.createElement("button");
        b.textContent = c.label;
        b.setAttribute("data-ann-case", c.key);
        b.setAttribute("data-ann-slot", r.id);
        var on = (r.styles.transform || "") === c.key;
        Object.assign(b.style, {
          flex: "1", padding: "4px 2px", borderRadius: "5px", border: "0", cursor: "pointer",
          font: "600 10px " + SANS, whiteSpace: "nowrap",
          background: on ? pal.surface2 : "transparent", color: on ? pal.text : pal.text3
        });
        seg.appendChild(b);
      });
      caseRow.append(label("Case"), seg);
      box.appendChild(caseRow);

      SLIDERS.forEach(function (s) {
        var row = document.createElement("div");
        Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px" });

        var set = r.styles[s.key] !== null && r.styles[s.key] !== undefined;
        // Unset sliders start where the PAGE already is, not at some arbitrary
        // zero — otherwise the first nudge of any control is a jump rather than
        // an adjustment, and you lose the thing you were comparing against.
        var start = set ? r.styles[s.key]
          : s.key === "sizeScale" ? 1
          : s.key === "lineHeight" ? r.base.lineHeight
          : s.key === "tracking" ? r.base.tracking
          : 0;
        start = Math.max(s.min, Math.min(s.max, start));

        var input = document.createElement("input");
        input.type = "range";
        input.min = s.min; input.max = s.max; input.step = s.step; input.value = start;
        input.setAttribute("data-ann-range", s.key);
        input.setAttribute("data-ann-slot", r.id);
        input.setAttribute("aria-label", s.label);
        // accentColor is deliberately absent: ui.js's stylesheet restyles the
        // track and thumb outright, and accentColor only applies to a control
        // still using its native appearance.
        Object.assign(input.style, { flex: "1", minWidth: "0", cursor: "pointer" });

        var out = document.createElement("span");
        out.textContent = s.fmt(start);
        out.setAttribute("data-ann-readout", s.key);
        // Muted until you have actually set it: the number is the page's own
        // until then, and showing it at full strength would claim a decision
        // nobody made.
        Object.assign(out.style, { flex: "none", width: "62px", textAlign: "right", font: "11px " + SANS, color: set ? pal.text : pal.text3 });

        row.append(label(s.label), input, out);
        if (set) row.appendChild(ghostButton("↺", "fonts-clear-one", r.id, "Put " + s.label.toLowerCase() + " back"))
          .lastChild && row.lastChild.setAttribute("data-ann-key", s.key);
        box.appendChild(row);
      });

      // Weight and the two switches share a line — none of them needs a slider's
      // width, and three short controls stacked would push the page off screen.
      var last = document.createElement("div");
      Object.assign(last.style, { display: "flex", alignItems: "center", gap: "10px" });
      var wWrap = document.createElement("div");
      Object.assign(wWrap.style, { position: "relative", display: "flex", flex: "none" });
      var weight = document.createElement("select");
      weight.setAttribute("data-ann-change", "font-weight");
      weight.setAttribute("data-ann-slot", r.id);
      weight.setAttribute("aria-label", "Weight");
      (r.weights || []).forEach(function (w) {
        var o = document.createElement("option"); o.value = w; o.textContent = w === "keep" ? "weight: keep" : "weight: " + w;
        if (w === r.styles.weight) o.selected = true;
        weight.appendChild(o);
      });
      Object.assign(weight.style, {
        appearance: "none", WebkitAppearance: "none", font: "600 11px " + SANS,
        padding: "5px 22px 5px 9px", borderRadius: "7px", border: "1px solid " + pal.border,
        background: pal.elevated, color: pal.text2, cursor: "pointer"
      });
      var wChev = picker.chevron(5);
      Object.assign(wChev.style, { position: "absolute", right: "8px", top: "50%", marginTop: "-4px" });
      wWrap.append(weight, wChev);
      last.appendChild(wWrap);

      TOGGLES.forEach(function (t) {
        var lab = document.createElement("label");
        Object.assign(lab.style, { display: "flex", alignItems: "center", gap: "5px", color: r.styles[t.key] ? pal.text : pal.text3, font: "11px " + SANS, cursor: "pointer" });
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!r.styles[t.key];
        cb.setAttribute("data-ann-toggle", t.key);
        cb.setAttribute("data-ann-slot", r.id);
        cb.style.accentColor = pal.accent;
        lab.append(cb, document.createTextNode(t.label));
        last.appendChild(lab);
      });

      var clear = ghostButton("Reset type", "fonts-clear-styles", r.id, "Put this card's type back, keeping the font");
      clear.style.marginLeft = "auto";
      last.appendChild(clear);
      box.appendChild(last);
      return box;
    }

    function card(r) {
      var c = document.createElement("div");
      c.setAttribute("data-ann-slot-row", r.id);
      c.setAttribute("data-ann-family", r.value || "");
      var open = expandedId === r.id;
      Object.assign(c.style, { display: "flex", flexDirection: "column", gap: "6px", background: pal.surface2, border: "1px solid " + (open ? pal.border : pal.hairline), borderRadius: "9px", padding: "8px 9px" });

      // Line 1 — what the page has. A fact, so it is set in the data font the
      // rest of this tool uses for measured values.
      var fact = document.createElement("div");
      Object.assign(fact.style, { display: "flex", alignItems: "baseline", gap: "8px" });
      var from = document.createElement("span");
      from.textContent = r.label;
      from.title = r.label;
      Object.assign(from.style, { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: pal.text2, font: "600 11px " + SANS });
      var count = document.createElement("span");
      count.textContent = r.detail;
      Object.assign(count.style, { flex: "none", color: pal.text3, font: "10px " + SANS, marginRight: "2px" });
      var kill = document.createElement("button"); kill.textContent = "✕";
      kill.setAttribute("aria-label", "Remove this font");
      kill.setAttribute("data-ann-act", "fonts-remove");
      kill.setAttribute("data-ann-slot", r.id);
      Object.assign(kill.style, { flex: "none", width: "17px", height: "17px", padding: "0", borderRadius: "5px", border: "0", background: "transparent", color: pal.text3, font: "10px " + SANS, cursor: "pointer", lineHeight: "1" });
      fact.append(from, count, kill);

      // Line 2 — the font itself, always visible, because it is the decision the
      // other eight controls are in service of.
      var controls = document.createElement("div");
      Object.assign(controls.style, { display: "flex", alignItems: "stretch", gap: "6px" });
      var trigger = document.createElement("button");
      trigger.setAttribute("data-ann-act", "font-open");
      trigger.setAttribute("data-ann-slot", r.id);
      Object.assign(trigger.style, { flex: "1", minWidth: "0", display: "flex", alignItems: "center", gap: "7px", padding: "6px 9px", borderRadius: "7px", border: "1px solid " + pal.border, background: pal.elevated, cursor: "pointer", textAlign: "left" });
      var triggerText = document.createElement("span");
      triggerText.textContent = r.value || "Choose a font";
      Object.assign(triggerText.style, {
        flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: r.value ? pal.text : pal.text3,
        fontFamily: r.value ? '"' + r.value + '", ' + SANS : SANS,
        fontSize: r.value ? "14px" : "12px"
      });
      trigger.append(triggerText, picker.chevron(6));
      controls.appendChild(trigger);

      if (r.value) {
        var undo = ghostButton("↺", "font-clear", r.id, "Put the page's own font back");
        undo.style.width = "28px";
        controls.appendChild(undo);
      }
      var disclose = ghostButton(open ? "Type ▴" : "Type ▾", "fonts-expand", r.id, open ? "Hide the type controls" : "Case, size, leading, tracking and more");
      Object.assign(disclose.style, { padding: "6px 9px", color: open ? pal.text : pal.text3 });
      controls.appendChild(disclose);

      c.append(fact, controls);
      if (open) c.appendChild(typography(r));
      if (r.status) {
        var msg = document.createElement("div");
        msg.textContent = r.status;
        Object.assign(msg.style, { color: pal.accent, font: "11px/1.4 " + SANS, padding: "2px 2px 0" });
        c.appendChild(msg);
      }
      return c;
    }

    var lastRows = [];
    function setSlots(rows) {
      lastRows = rows || [];
      cards.textContent = "";
      if (!lastRows.length) { cards.style.display = "none"; expandedId = null; return; }
      cards.style.display = "flex";
      // A card that has gone away must not keep the panel expanded at nothing.
      if (expandedId !== null && !lastRows.some(function (r) { return r.id === expandedId; })) expandedId = null;
      lastRows.forEach(function (r) { cards.appendChild(card(r)); });
    }
    function rowById(id) {
      for (var i = 0; i < lastRows.length; i++) if (lastRows[i].id === id) return lastRows[i];
      return null;
    }
    function slotOf(node) { return Number(node.getAttribute("data-ann-slot")); }

    // ---- one delegated listener per event type, on document, in capture ----
    // Same reasoning as ui.js and fontpicker.js: a host page that runs its own
    // capture handler and calls stopPropagation kills anything downstream, and
    // these controls are the only way to drive the mode.
    function ours(node) { return node && el.contains(node); }

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest("[data-ann-act],[data-ann-case]");
      if (!hit || !ours(hit)) return;
      var caseKey = hit.getAttribute("data-ann-case");
      if (caseKey !== null) {
        if (handlers.style) handlers.style(slotOf(hit), "transform", caseKey || null, false);
        return;
      }
      var act = hit.getAttribute("data-ann-act");
      if (act === "fonts-expand") {
        expandedId = expandedId === slotOf(hit) ? null : slotOf(hit);
        setSlots(lastRows);
        return;
      }
      if (act === "fonts-remove") { if (handlers.remove) handlers.remove(slotOf(hit)); return; }
      if (act === "fonts-reset") { if (handlers.reset) handlers.reset(); return; }
      if (act === "fonts-clear-styles") { if (handlers.clearStyles) handlers.clearStyles(slotOf(hit)); return; }
      if (act === "fonts-clear-one") {
        if (handlers.style) handlers.style(slotOf(hit), hit.getAttribute("data-ann-key"), null, false);
        return;
      }
      if (act === "font-clear") {
        var row = rowById(slotOf(hit));
        if (handlers.pickFont) handlers.pickFont(slotOf(hit), "", row ? row.styles.weight : "keep");
        return;
      }
      if (act === "font-open") {
        var r = rowById(slotOf(hit));
        picker.open(hit, {
          items: catalogue,
          note: catalogueNote,
          reserve: opts.reserve || null,
          value: r ? r.value : "",
          onNeedPreview: previewLoader,
          onPick: function (name) {
            var now = rowById(slotOf(hit));
            if (handlers.pickFont) handlers.pickFont(slotOf(hit), name, now ? now.styles.weight : "keep");
          }
        });
      }
    }, true);

    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !ours(t)) return;
      if (t.getAttribute("data-ann-change") === "font-weight") {
        var row = rowById(slotOf(t));
        if (handlers.pickFont) handlers.pickFont(slotOf(t), row ? row.value : "", t.value);
        return;
      }
      var toggle = t.getAttribute("data-ann-toggle");
      if (toggle && handlers.style) handlers.style(slotOf(t), toggle, t.checked, false);
    }, true);

    // Sliders report on `input`, i.e. continuously while dragging — that IS the
    // feature, since the whole point is watching the page move under the handle.
    // Two things keep it from being unusable:
    //   - the readout is updated HERE, locally, so a drag never rebuilds the
    //     panel and destroys the slider under the cursor;
    //   - `live` is passed through so fonts.js can restyle the known group
    //     instead of re-sweeping the whole document on every frame.
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !ours(t)) return;
      var key = t.getAttribute("data-ann-range");
      if (!key) return;
      var value = Number(t.value);
      var row = t.closest("[data-ann-slot-row]");
      var out = row && row.querySelector('[data-ann-readout="' + key + '"]');
      if (out) {
        var spec = null;
        for (var i = 0; i < SLIDERS.length; i++) if (SLIDERS[i].key === key) spec = SLIDERS[i];
        if (spec) out.textContent = spec.fmt(value);
        out.style.color = pal.text;
      }
      if (handlers.style) handlers.style(slotOf(t), key, value, true);
    }, true);

    return {
      el: el,
      setSlots: setSlots,
      setOptions: setOptions,
      setStatus: setStatus,
      onPickFont: function (fn) { handlers.pickFont = fn; },
      onStyle: function (fn) { handlers.style = fn; },
      onClearStyles: function (fn) { handlers.clearStyles = fn; },
      onRemove: function (fn) { handlers.remove = fn; },
      onReset: function (fn) { handlers.reset = fn; }
    };
  }

  return { create: create, CASES: CASES, SLIDERS: SLIDERS, TOGGLES: TOGGLES };
});
