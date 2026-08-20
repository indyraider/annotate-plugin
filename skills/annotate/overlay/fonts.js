// Annotate overlay — fonts mode. Click an element, and every element on the page
// set in that same font becomes one "slot" you can retype. Two clicks gives you
// two slots — headings and body — which is exactly a pairing, previewed live on
// the real page instead of on a specimen sheet.
//
// This is the ONE mode that writes to the page it is pointed at (Study's
// read-only promise is Study's, not the overlay's). It writes only inline
// `font-family`/`font-weight` on elements it matched, remembers the exact
// previous inline value of each, and can put every one of them back. Nothing
// else about the page is touched, and our own chrome (.__ann-ui) is skipped so
// the toolbar never restyles itself.
;(function (root, factory) {
  var core = (typeof module !== "undefined" && module.exports) ? require("./core.js") : (root.__annotatorMods && root.__annotatorMods.core);
  var api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.fonts = api; }
})(typeof self !== "undefined" ? self : this, function (core) {
  if (!core) throw new Error("annotate: fonts.js requires core.js to load first");

  // Curated rather than fetched: the Google Fonts *catalogue* API needs an API
  // key, and a key in a dev tool is a key in a git repo. These are the families
  // people actually pair with, which is the job — a searchable list of 1500
  // would be worse, not better.
  var WEB_FONTS = [
    "Inter", "Manrope", "DM Sans", "Work Sans", "Plus Jakarta Sans", "Space Grotesk",
    "Outfit", "Figtree", "Sora", "Archivo", "Public Sans", "IBM Plex Sans", "Rubik",
    "Karla", "Barlow", "Epilogue", "Bricolage Grotesque", "Instrument Sans", "Schibsted Grotesk",
    "Playfair Display", "Fraunces", "Instrument Serif", "Lora", "Source Serif 4",
    "Libre Baskerville", "EB Garamond", "Crimson Pro", "Newsreader", "Spectral",
    "DM Serif Display", "Cormorant Garamond", "Bitter", "Literata",
    "JetBrains Mono", "IBM Plex Mono", "Space Mono", "Roboto Mono", "Fira Code",
    "Bebas Neue", "Anton", "Syne", "Unbounded", "Chivo"
  ];

  // The FALLBACK list only. Real enumeration is queryLocalFonts() (see
  // loadSystemFonts) — measured 2026-08-20 on this machine: 449 families against
  // the 43 this list can find, and the ones it misses are the interesting ones
  // (GarageGothic, Geist, anything bought or bundled with a design tool). A
  // probe can only ever find a name somebody thought to type here, which is the
  // wrong shape of answer for "what fonts do I own".
  var LOCAL_CANDIDATES = [
    "Helvetica", "Helvetica Neue", "Avenir", "Avenir Next", "Futura", "Optima",
    "Baskerville", "Palatino", "Georgia", "Times New Roman", "Garamond", "Hoefler Text",
    "Didot", "Bodoni 72", "Gill Sans", "Gill Sans MT", "Copperplate", "Trebuchet MS",
    "Verdana", "Tahoma", "Arial", "Arial Black", "Impact", "Courier New", "Menlo",
    "Monaco", "SF Mono", "SF Pro Text", "SF Pro Display", "New York", "American Typewriter",
    "Charter", "Iowan Old Style", "Rockwell", "Lucida Grande", "Geneva", "Skia",
    "Cochin", "Big Caslon", "Andale Mono", "Consolas", "Segoe UI", "Calibri", "Cambria",
    "Franklin Gothic Medium", "Century Gothic", "Perpetua", "Comic Sans MS", "Papyrus"
  ];

  var WEIGHTS = ["keep", "300", "400", "500", "600", "700", "800"];

  // Same cap and the same honesty rule as study.js's page sweep: a silent cap
  // reports a partial swap as if it were the whole page.
  var SWEEP_CAP = 8000;

  // ---- which fonts does this machine actually have? -------------------------
  //
  // Measured, not asked. `queryLocalFonts()` is the API for this and it raises a
  // permission prompt — which, in a Playwright-driven browser, nobody is there
  // to answer. Canvas width-measurement needs no permission and no network: set
  // the candidate with a generic fallback, set the generic alone, and compare.
  // Identical width means the candidate never resolved.
  //
  // All three generics are probed because a Mac's `sans-serif` IS Helvetica —
  // probing only that one would report Helvetica as missing. One difference is
  // enough to prove the family resolved.
  var GENERICS = ["serif", "sans-serif", "monospace"];
  var PROBE = "mmmwwwiiilll0O@";
  var probeCtx = null;
  function measure(spec) {
    if (!probeCtx) probeCtx = document.createElement("canvas").getContext("2d");
    probeCtx.font = "72px " + spec;
    return probeCtx.measureText(PROBE).width;
  }
  function quoted(name) { return '"' + String(name).replace(/"/g, '\\"') + '"'; }
  // A generic ("sans-serif") must go into a font stack BARE — quoted, the browser
  // reads it as the name of a font nobody has, and the fallback silently stops
  // being a fallback.
  function familyToken(name) { return GENERICS.indexOf(name) !== -1 || name === "cursive" || name === "fantasy" || name === "system-ui" ? name : quoted(name); }
  function isInstalled(name) {
    var q = quoted(name);
    for (var i = 0; i < GENERICS.length; i++) {
      if (measure(q + ", " + GENERICS[i]) !== measure(GENERICS[i])) return true;
    }
    return false;
  }

  // A web family that is ALSO installed is offered as local — no network, and it
  // keeps working on a site whose CSP refuses the Google stylesheet.
  function buildCatalogue(localNames) {
    var seen = {}, out = [];
    localNames.forEach(function (name) {
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ name: name, source: "local" });
    });
    WEB_FONTS.forEach(function (name) {
      if (seen[name]) return;
      seen[name] = true;
      out.push({ name: name, source: "web" });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  // The fallback path: probe a fixed candidate list by measurement. Only reached
  // when queryLocalFonts is missing or refused.
  function probedLocalNames() {
    var out = [], seen = {};
    LOCAL_CANDIDATES.concat(WEB_FONTS).forEach(function (name) {
      if (seen[name]) return;
      seen[name] = true;
      if (isInstalled(name)) out.push(name);
    });
    return out;
  }

  var catalogue = null, catalogueSource = "probed", enumState = "idle";
  // Synchronous: whatever is known right now. Never waits — the picker has to
  // open instantly, and it upgrades itself in place when the real list lands.
  function available() {
    if (!catalogue) catalogue = buildCatalogue(probedLocalNames());
    return catalogue;
  }
  function catalogueNote() {
    return catalogueSource === "system" ? "" :
      "Showing a curated list — this browser would not read your installed fonts.";
  }

  // The real answer, once per page. queryLocalFonts() needs the `local-fonts`
  // permission; a Playwright context can grant it outright
  // (context.grantPermissions(["local-fonts"]) — see SKILL.md's boot snippet),
  // and with it granted there is no prompt and no gesture requirement.
  //
  // Every failure path lands on the probe list rather than on an error: denied
  // permission rejects, an older browser has no such function, and a prompt
  // nobody answers never settles at all — which is what the ceiling is for.
  var ENUM_CEILING_MS = 4000;
  function loadSystemFonts(onDone) {
    if (enumState !== "idle") return;
    if (typeof window.queryLocalFonts !== "function") { enumState = "done"; return; }
    enumState = "running";
    var settled = false;
    var finish = function (names) {
      if (settled) return;
      settled = true;
      enumState = "done";
      if (names && names.length) {
        catalogue = buildCatalogue(names);
        catalogueSource = "system";
      }
      if (onDone) onDone();
    };
    setTimeout(function () { finish(null); }, ENUM_CEILING_MS);
    try {
      window.queryLocalFonts().then(function (faces) {
        var names = [], seen = {};
        for (var i = 0; i < faces.length; i++) {
          var n = faces[i] && faces[i].family;
          if (n && !seen[n]) { seen[n] = true; names.push(n); }
        }
        finish(names);
      })["catch"](function () { finish(null); });
    } catch (e) { finish(null); }
  }

  // ---- loading a web font on demand ----------------------------------------
  //
  // The v1 css API, not css2, and deliberately: css2 returns 400 Bad Request for
  // a weight a family does not ship, so one static-only family in the list would
  // break its own row. v1 silently drops variants it cannot serve, which is the
  // behaviour that lets a single hard-coded weight list cover 40 families with no
  // per-family metadata table to keep in sync.
  var loaded = {};
  function ensureWebFont(name, onSettled) {
    if (loaded[name]) { onSettled(loaded[name]); return; }
    var link = document.createElement("link");
    link.className = "__ann-ui";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css?family=" + encodeURIComponent(name).replace(/%20/g, "+") +
                ":300,400,500,600,700,800&display=swap";
    var settled = false;
    var done = function (state) {
      if (settled) return;
      settled = true;
      clearTimeout(ceiling);
      loaded[name] = state;
      onSettled(state);
    };

    // The LINK's own load/error events, not document.fonts.load() on its own.
    //
    // Caught live 2026-08-20: probing document.fonts immediately after appending
    // the <link> resolves with an EMPTY face list, because the stylesheet has
    // not been parsed yet — so a font that loaded perfectly reported itself
    // "blocked" while rendering correctly on screen. An empty face list means
    // "no @font-face rule is registered YET", which is indistinguishable from
    // "blocked" at that instant and is the wrong reading almost every time.
    //
    // `load` fires once the stylesheet is fetched AND parsed; `error` fires on a
    // CSP refusal or a network failure, which is the real blocked case. Only
    // after `load` is document.fonts able to answer, and it is still worth
    // asking — it is what actually pulls the font FILES the stylesheet points at.
    link.onload = function () {
      if (!document.fonts || !document.fonts.load) return done("unknown");
      document.fonts.load('400 16px ' + quoted(name), PROBE).then(function (faces) {
        done(faces && faces.length ? "ok" : "blocked");
      })["catch"](function () { done("blocked"); });
    };
    link.onerror = function () { done("blocked"); };
    // Neither event firing at all leaves the row reading "loading…" for ever.
    // "unknown" applies the swap with no warning attached, which is the right
    // way round: the fallback stack already degrades to the page's own font, so
    // the worst case is a swap that looks like it did nothing, not a false
    // accusation against a site that blocked nothing.
    var ceiling = setTimeout(function () { done("unknown"); }, 8000);
    document.head.appendChild(link);
  }

  // ctx = { pal, ui, state, save, persist, notify } — see index.js. Fonts mode
  // uses ui (highlight) and notify (repaint row 2) only.
  function create(ctx) {
    var ui = ctx.ui, notify = ctx.notify;

    var slots = [];        // [{ id, family, to, weight, count, truncated, source, status, entries }]
    var nextId = 1;
    // Which slot owns an element right now. Without this, swapping headings to
    // Inter and then clicking body text that was ALREADY Inter would have the
    // second slot re-match the first slot's elements and steal them — the
    // headings would silently follow the body slot from then on.
    var owner = new WeakMap();

    // The focused card's elements, outlined where they stand. Reported live
    // 2026-08-20: clicking something highlighted it for exactly as long as the
    // cursor stayed on it, so there was no way to see WHICH elements a card had
    // claimed — the "3 elements" count was a number you had to take on trust.
    // The mark is an attribute, and ui.js's stylesheet draws it, so it survives
    // scrolling and reflow without a single reposition.
    var PICK_ATTR = "data-ann-font-pick";
    var focused = null;
    function clearMarks() {
      var marked = document.querySelectorAll("[" + PICK_ATTR + "]");
      for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(PICK_ATTR);
    }
    // A swapped slot owns a known element list; an unswapped one has to be
    // matched live, because nothing has claimed its elements yet.
    function groupOf(slot) {
      if (slot.entries.length) return slot.entries.map(function (e) { return e.el; });
      return matching(slot.family, slot).els;
    }
    function focusSlot(slot) {
      clearMarks();
      focused = slot || null;
      if (!focused) return;
      groupOf(focused).forEach(function (el) { el.setAttribute(PICK_ATTR, ""); });
    }

    function slotById(id) {
      for (var i = 0; i < slots.length; i++) if (slots[i].id === id) return slots[i];
      return null;
    }

    // Every element whose CURRENT computed first family is `family`, minus our
    // own chrome and minus anything another slot has already claimed.
    function matching(family, slot) {
      var els = document.querySelectorAll("*"), out = [], truncated = false;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest && el.closest(".__ann-ui")) continue;
        var own = owner.get(el);
        if (own && own !== slot) continue;
        if (core.firstFamily(getComputedStyle(el).fontFamily) !== family) continue;
        if (out.length >= SWEEP_CAP) { truncated = true; break; }
        out.push(el);
      }
      return { els: out, truncated: truncated };
    }

    function restore(el, prop, value, priority) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
    function revert(slot) {
      slot.entries.forEach(function (e) {
        restore(e.el, "font-family", e.family, e.familyPri);
        restore(e.el, "font-weight", e.weight, e.weightPri);
        owner["delete"](e.el);
      });
      slot.entries = [];
      slot.count = 0;
    }

    // `to` null puts the slot back to the page's own font without removing the
    // slot — the row stays so you can try the next candidate without re-clicking
    // the element.
    function apply(slot) {
      revert(slot);
      if (!slot.to) { slot.status = ""; if (notify) notify(); return; }
      var found = matching(slot.family, slot);
      slot.truncated = found.truncated;
      // The page's ORIGINAL family is kept on the end of the stack, so a font
      // that fails to load degrades back to what was there before rather than
      // to the browser's default serif — a preview that silently turns the page
      // into Times is worse than one that simply hasn't changed yet.
      var stack = quoted(slot.to) + ", " + familyToken(slot.family);
      found.els.forEach(function (el) {
        slot.entries.push({
          el: el,
          family: el.style.getPropertyValue("font-family"),
          familyPri: el.style.getPropertyPriority("font-family"),
          weight: el.style.getPropertyValue("font-weight"),
          weightPri: el.style.getPropertyPriority("font-weight")
        });
        owner.set(el, slot);
        el.style.setProperty("font-family", stack, "important");
        if (slot.weight && slot.weight !== "keep") el.style.setProperty("font-weight", slot.weight, "important");
      });
      slot.count = found.els.length;
      // The swap replaced the live match with a concrete element list, so the
      // outline has to be redrawn from it — otherwise it keeps describing the
      // group as it was before this slot claimed it.
      if (focused === slot) focusSlot(slot);
      if (notify) notify();
    }

    // The picker hands back a bare name; which catalogue it came from decides
    // whether a stylesheet has to be fetched at all.
    function setFont(id, to, weight) {
      var slot = slotById(id);
      if (!slot) return;
      slot.to = to || null;
      slot.weight = weight || "keep";
      var entry = null;
      available().forEach(function (f) { if (f.name === to) entry = f; });
      slot.source = entry ? entry.source : "unknown";
      if (to && slot.source === "web") {
        slot.status = "loading " + to + "…";
        if (notify) notify();
        ensureWebFont(to, function (state) {
          slot.status = state === "ok" ? "" :
            state === "blocked" ? "⚠ " + to + " could not load here — this site blocks Google Fonts. Installed fonts still work."
                                : "";
          apply(slot);
        });
        return;
      }
      slot.status = to && slot.source === "unknown" ? "⚠ " + to + " is not installed and is not in the web list — showing the fallback." : "";
      apply(slot);
    }

    function removeSlot(id) {
      var slot = slotById(id);
      if (!slot) return;
      if (focused === slot) focusSlot(null);
      revert(slot);
      slots = slots.filter(function (s) { return s !== slot; });
      if (notify) notify();
    }
    function reset() {
      focusSlot(null);
      slots.forEach(revert);
      slots = [];
      if (notify) notify();
    }

    // A click makes a slot out of whatever font the clicked element is in. If it
    // is already inside a slot's swap, that slot is re-selected rather than a
    // second slot being created for the font we ourselves just applied.
    function pick(el) {
      var own = owner.get(el);
      if (own) { focusSlot(own); return own; }
      var family = core.firstFamily(getComputedStyle(el).fontFamily);
      if (!family) return null;
      for (var i = 0; i < slots.length; i++) if (slots[i].family === family) { focusSlot(slots[i]); return slots[i]; }
      var found = matching(family, null);
      var slot = { id: nextId++, family: family, to: null, weight: "keep", count: found.els.length, truncated: found.truncated, source: null, status: "", entries: [] };
      slots.push(slot);
      focusSlot(slot);
      return slot;
    }

    function onMousemove(e) {
      if (ui.isOurs(e.target)) return;
      ui.showHighlight(e.target);
    }
    // Study's convention, deliberately identical: a plain click stops nothing
    // (a font preview you cannot scroll or navigate through is not a preview),
    // Shift skips the pick entirely, and Alt+click holds the page still so a
    // link or button can be picked without being followed.
    function onClick(e) {
      if (e.shiftKey) return;
      if (ui.isOurs(e.target)) return;
      if (e.altKey) { e.preventDefault(); e.stopPropagation(); }
      pick(e.target);
      if (notify) notify();
    }

    var attached = false;
    function enable() {
      if (attached) return;
      attached = true;
      ui.setCrosshair(true);
      document.addEventListener("mousemove", onMousemove, true);
      document.addEventListener("click", onClick, true);
    }
    // Swaps deliberately SURVIVE leaving the mode: judging a pairing means
    // scrolling the page and clicking through the app with the new fonts on, and
    // that is impossible from inside a mode that owns every click. Reset (or a
    // reload — these are inline styles) is how they go away.
    function disable() {
      if (!attached) return;
      attached = false;
      ui.setCrosshair(false);
      document.removeEventListener("mousemove", onMousemove, true);
      document.removeEventListener("click", onClick, true);
      ui.hideHighlight();
      // The outline is a picking aid, not a result — the SWAPS stay when you
      // leave the mode, the marks do not.
      focusSlot(null);
    }

    // Row data for ui.js — plain values only, no slot objects and no DOM.
    function rows() {
      return slots.map(function (s) {
        return {
          id: s.id,
          label: s.family,
          detail: s.count + (s.truncated ? "+" : "") + " element" + (s.count === 1 ? "" : "s"),
          value: s.to || "",
          weight: s.weight || "keep",
          weights: WEIGHTS,
          status: s.status || ""
        };
      });
    }

    // The agent-facing readout. Synchronous — there is nothing to sample, only
    // the choices already made. `count` is how many elements the swap actually
    // touched, which is what tells a swap that worked from one that matched
    // nothing.
    function take() {
      return {
        url: location.href,
        fontsAvailable: available().length,
        // Which path produced the list, so a report can say "449 fonts on this
        // Mac" or admit it only probed for 43 — those are different answers.
        fontsFrom: catalogueSource,
        swaps: slots.filter(function (s) { return !!s.to; }).map(function (s) {
          return { from: s.family, to: s.to, weight: s.weight === "keep" ? null : s.weight, count: s.count, source: s.source, truncated: !!s.truncated };
        })
      };
    }

    // The picker previews a web font by rendering its own name in it, which
    // needs the stylesheet before it can show anything. Loading is the mode's
    // job, not the chrome's — the picker only says which name came into view.
    function preloadPreview(name, onDone) {
      var entry = null;
      available().forEach(function (f) { if (f.name === name) entry = f; });
      if (!entry || entry.source !== "web") return;
      ensureWebFont(name, function () { if (onDone) onDone(name); });
    }

    return {
      enable: enable, disable: disable, available: available, rows: rows,
      setFont: setFont, removeSlot: removeSlot, reset: reset, take: take,
      preloadPreview: preloadPreview, loadSystemFonts: loadSystemFonts, catalogueNote: catalogueNote,
      slotCount: function () { return slots.length; }
    };
  }

  return { create: create, WEB_FONTS: WEB_FONTS, LOCAL_CANDIDATES: LOCAL_CANDIDATES, WEIGHTS: WEIGHTS };
});
