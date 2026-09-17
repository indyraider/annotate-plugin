// Annotate overlay — the font picker popover. A searchable list where every row
// is set IN the font it names, because the name of a typeface tells you nothing
// and the shape of it tells you everything. That single property is the reason
// this exists instead of a <datalist>: the native one renders every option in
// the browser's UI font, which is the one font you are guaranteed not to be
// choosing.
//
// Knows nothing about fonts modes, slots or Google. It is handed a list, a
// current value, and two callbacks — one when a row is chosen, one when a row
// that needs loading before it can preview itself scrolls into view.
;(function (root, factory) {
  var palette = (typeof module !== "undefined" && module.exports) ? require("./palette.js") : (root.__annotatorMods && root.__annotatorMods.palette);
  var api = factory(palette);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.fontpicker = api; }
})(typeof self !== "undefined" ? self : this, function (palette) {
  if (!palette) throw new Error("annotate: fontpicker.js requires palette.js to load first");
  var SANS = palette.SANS;
  var Z = 2147483647;

  var FILTERS = [
    { key: "all", label: "All" },
    { key: "local", label: "On this Mac" },
    { key: "web", label: "Google" }
  ];

  // Pure: rank a query against a list. Prefix beats contains, so typing "in"
  // puts Inter above Bricolage Grotesque instead of burying it alphabetically.
  // Exported for the self-check — ranking is the one piece of logic in this file
  // that can be wrong without looking wrong.
  function rank(items, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return items.slice();
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var at = items[i].name.toLowerCase().indexOf(q);
      if (at === -1) continue;
      out.push({ item: items[i], score: at === 0 ? 0 : 1, at: at, i: i });
    }
    out.sort(function (a, b) { return a.score - b.score || a.at - b.at || a.i - b.i; });
    return out.map(function (r) { return r.item; });
  }

  // Chevrons and the magnifier are drawn from borders rather than inline SVG.
  // Not a style preference: sites that set `require-trusted-types-for 'script'`
  // (github.com is one) throw on innerHTML, and building SVG through
  // createElementNS for two 8px glyphs costs more code than the borders do.
  function chevron(pal, size) {
    var c = document.createElement("span");
    Object.assign(c.style, {
      width: size + "px", height: size + "px", flex: "none",
      borderRight: "1.5px solid " + pal.text3, borderBottom: "1.5px solid " + pal.text3,
      transform: "rotate(45deg) translate(-1px, -1px)", pointerEvents: "none"
    });
    return c;
  }

  function create(pal) {
    var state = { items: [], value: "", onPick: null, onNeedPreview: null, onGrant: null, active: -1, rows: [], filter: "all", anchor: null, reserve: null };

    var LIST_MAX = 296, LIST_MIN = 132;

    var pop = document.createElement("div"); pop.className = "__ann-ui";
    Object.assign(pop.style, {
      position: "fixed", zIndex: Z, display: "none", width: "286px",
      background: pal.elevated, border: "1px solid " + pal.border, borderRadius: "10px",
      boxShadow: "0 16px 48px rgba(0,0,0,.44)", overflow: "hidden",
      font: "12px " + SANS, color: pal.text
    });

    // ---- search ----
    var searchWrap = document.createElement("div");
    Object.assign(searchWrap.style, { display: "flex", alignItems: "center", gap: "8px", padding: "9px 11px", borderBottom: "1px solid " + pal.hairline });
    var glassRing = document.createElement("span");
    Object.assign(glassRing.style, { width: "9px", height: "9px", borderRadius: "50%", border: "1.5px solid " + pal.text3, flex: "none", position: "relative" });
    var glassStem = document.createElement("span");
    Object.assign(glassStem.style, { position: "absolute", right: "-3px", bottom: "-3px", width: "4px", height: "1.5px", background: pal.text3, transform: "rotate(45deg)" });
    glassRing.appendChild(glassStem);
    // type="search" for the clear button the browser draws itself — one native
    // affordance is worth more than a hand-built ✕ that has to be kept in sync
    // with whether the field has text.
    var search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search fonts";
    search.setAttribute("aria-label", "Search fonts");
    Object.assign(search.style, {
      // No `outline: none` here — the focus ring is what tells a keyboard user
      // where they are, and ui.js now draws a real one for every control in the
      // overlay via :focus-visible. A mouse click on the field does not trigger
      // it, so the common case stays visually quiet either way.
      flex: "1", minWidth: "0", background: "transparent", border: "0",
      color: pal.text, font: "13px " + SANS, padding: "0"
    });
    searchWrap.append(glassRing, search);

    // ---- source filter ----
    var filterBar = document.createElement("div");
    Object.assign(filterBar.style, { display: "flex", gap: "3px", padding: "7px 8px", borderBottom: "1px solid " + pal.hairline });
    var chips = {};
    FILTERS.forEach(function (f) {
      var b = document.createElement("button");
      b.textContent = f.label;
      b.setAttribute("data-ann-fp-filter", f.key);
      Object.assign(b.style, { flex: "1", padding: "4px 6px", borderRadius: "6px", border: "1px solid transparent", background: "transparent", color: pal.text3, font: "600 11px " + SANS, cursor: "pointer", whiteSpace: "nowrap" });
      chips[f.key] = b;
      filterBar.appendChild(b);
    });
    function paintChips() {
      FILTERS.forEach(function (f) {
        var on = state.filter === f.key;
        Object.assign(chips[f.key].style, { background: on ? pal.surface2 : "transparent", color: on ? pal.text : pal.text3 });
      });
    }

    var list = document.createElement("div");
    Object.assign(list.style, { maxHeight: LIST_MAX + "px", overflowY: "auto", padding: "5px", scrollbarWidth: "thin" });

    var empty = document.createElement("div");
    Object.assign(empty.style, { display: "none", padding: "18px 12px", color: pal.text3, font: "12px " + SANS, textAlign: "center" });

    // A list that is quietly smaller than it should be must say so. When the
    // browser refuses to enumerate installed fonts, the picker falls back to a
    // curated handful — and "my font is missing" is unanswerable unless the
    // panel admits which list you are looking at.
    var note = document.createElement("div");
    Object.assign(note.style, { display: "none", padding: "8px 11px", borderTop: "1px solid " + pal.hairline, color: pal.text3, font: "10px/1.45 " + SANS });
    var noteText = document.createElement("div");
    var noteBtn = document.createElement("button");
    noteBtn.setAttribute("data-ann-fp-grant", "");
    Object.assign(noteBtn.style, { display: "none", marginTop: "6px", padding: "5px 9px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text, font: "600 11px " + SANS, cursor: "pointer" });
    note.append(noteText, noteBtn);
    // A note is data, not a string: the four reasons a list can come up short
    // need four different answers, and only two of them can be fixed by asking.
    function setNote(n) {
      if (!n) { note.style.display = "none"; return; }
      noteText.textContent = n.text || "";
      noteBtn.textContent = n.label || "Use my installed fonts";
      noteBtn.style.display = n.ask ? "inline-block" : "none";
      note.style.display = "block";
    }

    pop.append(searchWrap, filterBar, list, empty, note);
    document.body.appendChild(pop);

    // A web font cannot preview itself until its stylesheet is in, and fetching
    // forty of them to fill a list nobody scrolled is the reason this is lazy:
    // rows ask for their own font as they come into view, and only once.
    var asked = {};
    var io = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var name = e.target.getAttribute("data-ann-fp-name");
        io.unobserve(e.target);
        if (!name || asked[name]) return;
        asked[name] = true;
        if (state.onNeedPreview) state.onNeedPreview(name);
      });
    }, { root: list, rootMargin: "120px" }) : null;

    function paintActive() {
      state.rows.forEach(function (row, i) {
        var on = i === state.active;
        row.style.background = on ? pal.hover : "transparent";
      });
      var el = state.rows[state.active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }

    function render() {
      list.textContent = "";
      state.rows = [];
      var pool = state.items.filter(function (f) { return state.filter === "all" || f.source === state.filter; });
      var shown = rank(pool, search.value);

      if (!shown.length) {
        empty.style.display = "block";
        empty.textContent = search.value.trim()
          ? "No font matches “" + search.value.trim() + "”."
          : "No fonts in this group.";
        return;
      }
      empty.style.display = "none";

      shown.forEach(function (f) {
        var row = document.createElement("div");
        row.setAttribute("data-ann-fp-name", f.name);
        var chosen = f.name === state.value;
        Object.assign(row.style, {
          display: "flex", alignItems: "center", gap: "8px",
          padding: "6px 8px", borderRadius: "6px", cursor: "pointer", userSelect: "none"
        });

        var tick = document.createElement("span");
        tick.textContent = chosen ? "✓" : "";
        Object.assign(tick.style, { flex: "none", width: "12px", color: pal.accent, font: "600 11px " + SANS });

        // The row IS the specimen. 15px because a typeface's character does not
        // survive at the 12px the rest of this chrome is set in.
        var name = document.createElement("span");
        name.textContent = f.name;
        Object.assign(name.style, {
          flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: pal.text, fontFamily: '"' + f.name + '", ' + SANS, fontSize: "15px", lineHeight: "1.35"
        });

        // Only the minority case is tagged, and only while the list is mixed.
        // Labelling every local row "local" would put a word beside 43 of 82 rows
        // to say the unremarkable thing; keeping the tag under the Google filter
        // would repeat, on every row, what the filter above already says.
        if (f.source === "web" && state.filter === "all") {
          var tag = document.createElement("span");
          tag.textContent = "web";
          Object.assign(tag.style, { flex: "none", color: pal.text3, font: "10px " + SANS });
          row.append(tick, name, tag);
        } else {
          row.append(tick, name);
        }

        list.appendChild(row);
        state.rows.push(row);
        if (chosen) state.active = state.rows.length - 1;
        if (f.source === "web" && io) io.observe(row);
      });

      if (state.active >= state.rows.length) state.active = state.rows.length - 1;
      paintActive();
    }

    // The trigger's own top edge is NOT the ceiling. The trigger lives inside
    // the toolbar's second row, so opening "just above the trigger" lands the
    // popover across the mode tabs and the other cards — hiding the controls you
    // opened it from. Study's readout hit exactly this and fixed it the same way:
    // treat the whole bar's top edge as a hard floor, and shrink to fit above it.
    function floorY() {
      var y = state.anchor ? state.anchor.getBoundingClientRect().top : window.innerHeight;
      if (state.reserve) {
        try { var r = state.reserve.getBoundingClientRect(); if (r.height) y = Math.min(y, r.top); } catch (e) {}
      }
      return y;
    }
    function place() {
      if (!state.anchor) return;
      pop.style.visibility = "hidden";
      pop.style.display = "block";
      var floor = floorY() - 8;
      // maxHeight FIRST — offsetHeight below has to be the clamped height, not
      // the height the popover would have had if it were free to run long.
      var chromeH = searchWrap.offsetHeight + filterBar.offsetHeight + note.offsetHeight;
      list.style.maxHeight = Math.max(LIST_MIN, Math.min(LIST_MAX, floor - 16 - chromeH)) + "px";
      var h = pop.offsetHeight, w = pop.offsetWidth;
      var top = floor - h;
      // Only when there is genuinely no room above does it drop below, and even
      // then it is clamped into the viewport rather than running off the bottom.
      if (top < 8) top = Math.min(state.anchor.getBoundingClientRect().bottom + 6, window.innerHeight - h - 8);
      pop.style.top = Math.max(8, top) + "px";
      pop.style.left = Math.max(8, Math.min(state.anchor.getBoundingClientRect().left, window.innerWidth - w - 8)) + "px";
      pop.style.visibility = "visible";
    }

    function open(anchor, opts) {
      state.anchor = anchor;
      state.reserve = opts.reserve || null;
      state.items = opts.items || [];
      state.value = opts.value || "";
      state.onPick = opts.onPick || null;
      state.onNeedPreview = opts.onNeedPreview || null;
      state.onGrant = opts.onGrant || null;
      if (typeof opts.note === "string") setNote(opts.note);
      state.filter = "all";
      state.active = -1;
      search.value = "";
      paintChips();
      render();
      place();
      search.focus();
    }
    function close() {
      pop.style.display = "none";
      state.anchor = null;
      state.onPick = null;
    }
    function isOpen() { return pop.style.display !== "none"; }
    // Rows already on screen re-render with the font that just arrived. Without
    // this a preview loads and nothing repaints, so every web font looks
    // permanently unavailable.
    function refresh() { if (isOpen()) render(); }

    function choose(name) {
      var pick = state.onPick;
      close();
      if (pick) pick(name);
    }

    // Document-capture, for the same reason ui.js uses it: a host page that runs
    // its own capture handler and calls stopPropagation kills any listener
    // downstream of it, and this popover is the only way to choose a font.
    document.addEventListener("click", function (e) {
      if (!isOpen()) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var filterHit = t.closest("[data-ann-fp-filter]");
      if (filterHit && pop.contains(filterHit)) {
        state.filter = filterHit.getAttribute("data-ann-fp-filter");
        paintChips();
        render();
        place();
        return;
      }
      // The permission ask. It runs INSIDE this click handler on purpose — Chrome
      // only shows the prompt while the activation from the click is still live,
      // so this cannot be deferred, queued, or awaited on the way in.
      if (t.closest("[data-ann-fp-grant]") && pop.contains(t.closest("[data-ann-fp-grant]"))) {
        if (state.onGrant) state.onGrant();
        return;
      }
      var row = t.closest("[data-ann-fp-name]");
      if (row && list.contains(row)) { choose(row.getAttribute("data-ann-fp-name")); return; }
      // A click on the popover's own furniture (the search field, the scrollbar)
      // must not count as clicking away. Anything else does.
      if (pop.contains(t)) return;
      if (state.anchor && state.anchor.contains(t)) return;
      close();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!state.rows.length) return;
        var d = e.key === "ArrowDown" ? 1 : -1;
        state.active = (state.active + d + state.rows.length) % state.rows.length;
        paintActive();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        var row = state.rows[state.active];
        if (row) choose(row.getAttribute("data-ann-fp-name"));
      }
    }, true);

    list.addEventListener("mousemove", function (e) {
      var row = e.target && e.target.closest && e.target.closest("[data-ann-fp-name]");
      if (!row) return;
      var i = state.rows.indexOf(row);
      if (i === -1 || i === state.active) return;
      state.active = i;
      paintActive();
    });

    search.addEventListener("input", function () { state.active = 0; render(); place(); });

    return { open: open, close: close, isOpen: isOpen, refresh: refresh, setNote: setNote, el: pop, chevron: function (size) { return chevron(pal, size); } };
  }

  return { create: create, rank: rank, FILTERS: FILTERS };
});
