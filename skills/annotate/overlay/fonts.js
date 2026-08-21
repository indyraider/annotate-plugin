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
  // What the browser will actually let us read, kept as a diagnosis rather than
  // a boolean. Reported live 2026-08-20: the picker showed the curated 82 and
  // said only "this browser would not read your installed fonts", which names
  // neither the cause nor anything to do about it — and the four causes below
  // need four different answers.
  var permissionState = "unknown";
  // Why the last enumeration attempt did not produce a list. It used to be
  // discarded — every failure path funnelled into finish(null) — which made the
  // difference between "refused", "timed out" and "never ran" invisible from
  // outside, including to whoever was trying to work out why the picker was
  // short. A swallowed error is a bug you cannot be told about.
  var lastEnumError = null;
  // Resolved on EVERY use, not captured at load. A bare `window` mention is a
  // ReferenceError in Node (where the self-check runs this), so it has to be
  // guarded — but capturing it once at load time bound the answer to whenever
  // this module happened to be first required, which the self-check does through
  // index.js long before it sets up a window. That produced the worst possible
  // failure: loadSystemFonts took its "no window" branch and returned WITHOUT
  // calling back, so the caller's promise never settled, Node exited 0 with no
  // output, and the test silently did not run. Lazy costs a property lookup and
  // owes nothing to load order.
  function W() { return (typeof window !== "undefined") ? window : null; }
  function accessState() {
    if (!W()) return "unsupported";
    if (typeof W().queryLocalFonts !== "function") {
      // The API is hidden outright on a page that is not a secure context, which
      // is the single most likely reason for a real app on a plain-http origin.
      return W().isSecureContext === false ? "insecure" : "unsupported";
    }
    return permissionState;
  }
  function refreshPermission(onDone) {
    var done = function (state) { permissionState = state; if (onDone) onDone(); };
    if (!W() || !W().navigator || !W().navigator.permissions || !W().navigator.permissions.query) return done("unknown");
    try {
      W().navigator.permissions.query({ name: "local-fonts" })
        .then(function (st) { done(st.state); })["catch"](function () { done("unknown"); });
    } catch (e) { done("unknown"); }
  }
  // Synchronous: whatever is known right now. Never waits — the picker has to
  // open instantly, and it upgrades itself in place when the real list lands.
  function available() {
    if (!catalogue) catalogue = buildCatalogue(probedLocalNames());
    return catalogue;
  }
  // The note the picker shows at its foot when the list is short. `ask` marks
  // the cases a click can still fix — which is the whole point: the permission
  // can be granted from inside the page, by the person looking at the browser
  // window, and until now the only way to get it was a Playwright call in the
  // boot snippet that this tool could neither verify nor perform.
  function catalogueNote() {
    if (catalogueSource === "system") return null;
    var s = accessState();
    if (s === "insecure") return { text: "This page is plain http, so the browser hides your installed fonts. Works on https or localhost.", ask: false };
    if (s === "unsupported") return { text: "This browser can't list installed fonts, so this is the curated set.", ask: false };
    if (s === "denied") return { text: "Font access is blocked for this site. Allow it in the browser's site settings, then press Retry.", ask: true, label: "Retry" };
    return { text: "Showing a curated set. Your own fonts need the browser's permission.", ask: true, label: "Use my installed fonts" };
  }

  // The real answer, once per page. queryLocalFonts() needs the `local-fonts`
  // permission; a Playwright context can grant it outright
  // (context.grantPermissions(["local-fonts"]) — see SKILL.md's boot snippet),
  // and with it granted there is no prompt and no gesture requirement.
  //
  // Every failure path lands on the probe list rather than on an error: denied
  // permission rejects, an older browser has no such function, and a prompt
  // nobody answers never settles at all — which is what the ceiling is for.
  // The FIRST queryLocalFonts() on a page is cold: Chrome walks the machine's
  // whole font library off disk, which on 2517 faces measured 3-4 SECONDS.
  // Every call after it is served from cache in about 2ms — which is exactly why
  // this was so hard to see, since any probe run by hand afterwards looked
  // instant and fine.
  //
  // The old ceiling was 4000ms, sitting right on that boundary: win the race and
  // the picker showed 488 fonts, lose it and the result was discarded and the
  // curated 82 stuck for the rest of the page. Same code, same machine, opposite
  // outcomes — the "fonts keep disappearing" report.
  //
  // Raised well clear of a cold read, and, more importantly, a late answer is no
  // longer thrown away (see applyNames): the ceiling now only decides when to
  // stop WAITING, never whether the result counts.
  var ENUM_CEILING_MS = 20000;
  // MUST stay synchronous from its caller down to queryLocalFonts() when it is
  // reached from a click: Chrome only shows the permission prompt while the user
  // activation from that click is still live, and a single `await` before the
  // call spends it. That is why the permission state is not consulted here.
  // `ceilingMs` is a real parameter, not a test backdoor: the wait before giving
  // up is a property of the call, and production simply takes the default. It
  // exists because the behaviour that matters here — a late answer still
  // counting — is untestable if the only way to reach it is to wait 20 seconds.
  function loadSystemFonts(onDone, ceilingMs) {
    // Both early exits MUST still call back. A caller that wraps this in a
    // promise waits for ever otherwise, and "waits for ever" in Node is a silent
    // exit with status 0 — a test that does not run and does not say so.
    if (enumState !== "idle") { if (onDone) onDone(); return; }
    if (!W() || typeof W().queryLocalFonts !== "function") {
      enumState = "done";
      lastEnumError = "queryLocalFonts is not available on this page";
      if (onDone) onDone();
      return;
    }
    enumState = "running";
    // Upgrading the catalogue and giving up waiting are now two different
    // things. A result that arrives after the ceiling is still a good result —
    // discarding it is what made a slow machine look like a refusing one.
    var settled = false;
    var applyNames = function (names) {
      if (!names || !names.length) return false;
      catalogue = buildCatalogue(names);
      catalogueSource = "system";
      lastEnumError = null;
      return true;
    };
    var finish = function (names, why) {
      var upgraded = applyNames(names);
      // The ceiling may already have reported; a late success still repaints.
      if (settled && !upgraded) return;
      settled = true;
      clearTimeout(ceiling);
      enumState = "done";
      if (!upgraded) lastEnumError = why || "no fonts returned";
      if (onDone) onDone();
    };
    var ceiling = setTimeout(function () {
      finish(null, "still reading the font library after " + ((ceilingMs || ENUM_CEILING_MS) / 1000) + "s");
    }, ceilingMs || ENUM_CEILING_MS);
    try {
      W().queryLocalFonts().then(function (faces) {
        var names = [], seen = {};
        for (var i = 0; i < faces.length; i++) {
          var n = faces[i] && faces[i].family;
          if (n && !seen[n]) { seen[n] = true; names.push(n); }
        }
        finish(names);
      })["catch"](function (e) { finish(null, (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e))); });
    } catch (e) { finish(null, "threw synchronously: " + (e && e.message ? e.message : String(e))); }
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
    // The slot's record for one element, if it has claimed it — which is the
    // only place its pre-swap size still exists.
    function ownedEntry(slot, el) {
      for (var i = 0; i < slot.entries.length; i++) if (slot.entries[i].el === el) return slot.entries[i];
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

    // Every property this mode is allowed to touch, in one list rather than a
    // hand-written record/restore pair per property. Adding tracking used to
    // mean editing four places and remembering all of them; a property missed
    // in `revert` is a change that outlives Reset, which is the one promise this
    // mode cannot break.
    var TOUCHED = [
      "font-family", "font-weight", "font-size", "line-height",
      "letter-spacing", "word-spacing", "text-transform", "font-style", "font-variant-caps"
    ];
    function snapshot(el) {
      var prev = {};
      for (var i = 0; i < TOUCHED.length; i++) {
        var prop = TOUCHED[i];
        prev[prop] = { value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) };
      }
      return prev;
    }
    function restoreAll(e) {
      for (var i = 0; i < TOUCHED.length; i++) {
        var prop = TOUCHED[i], was = e.prev[prop];
        if (was && was.value) e.el.style.setProperty(prop, was.value, was.priority);
        else e.el.style.removeProperty(prop);
      }
    }
    function revert(slot) {
      slot.entries.forEach(function (e) {
        restoreAll(e);
        owner["delete"](e.el);
      });
      slot.entries = [];
      slot.count = 0;
    }

    // What a slot's settings mean as CSS, for one element.
    //
    // Two of these are deliberately RELATIVE, because a group is not uniform: an
    // h1 and an h2 in the same family have different sizes and leading, and
    // writing one absolute value across both flattens the page's own hierarchy
    // into a single size. `line-height` unitless and `letter-spacing`/
    // `word-spacing` in em are already ratios of each element's own size, so they
    // scale on their own. `font-size` is not — em resolves against the PARENT —
    // so the scale is multiplied per element against the size it had before this
    // slot touched it. `origPx` is read after revert(), so it is always the
    // page's own size and never a previously-scaled one.
    function declarationsFor(slot, origPx) {
      var s = slot.styles, out = {};
      if (slot.to) out["font-family"] = quoted(slot.to) + ", " + familyToken(slot.family);
      if (s.weight && s.weight !== "keep") out["font-weight"] = s.weight;
      if (s.sizeScale !== null && origPx) out["font-size"] = (origPx * s.sizeScale).toFixed(2) + "px";
      if (s.lineHeight !== null) out["line-height"] = String(s.lineHeight);
      if (s.tracking !== null) out["letter-spacing"] = s.tracking.toFixed(3) + "em";
      if (s.wordSpacing !== null) out["word-spacing"] = s.wordSpacing.toFixed(3) + "em";
      if (s.transform) out["text-transform"] = s.transform;
      if (s.italic) out["font-style"] = "italic";
      if (s.smallCaps) out["font-variant-caps"] = "small-caps";
      return out;
    }
    // Has this slot been asked to change anything at all?
    function isActive(slot) {
      var s = slot.styles;
      return !!(slot.to || (s.weight && s.weight !== "keep") || s.sizeScale !== null ||
                s.lineHeight !== null || s.tracking !== null || s.wordSpacing !== null ||
                s.transform || s.italic || s.smallCaps);
    }
    function blankStyles() {
      return { weight: "keep", sizeScale: null, lineHeight: null, tracking: null,
               wordSpacing: null, transform: null, italic: false, smallCaps: false };
    }

    // Reverting first is load-bearing, not tidiness: it is what makes the
    // computed values read below the PAGE's own, rather than the ones this slot
    // wrote a moment ago. Without it, dragging the size slider would compound —
    // 1.1x of 1.1x of 1.1x — and the original size would be unrecoverable.
    //
    // A slot with nothing set still keeps its card: you are still working on that
    // font, you have just put the page's own back while you look at it.
    function apply(slot) {
      revert(slot);
      if (!isActive(slot)) { if (notify) notify(); if (focused === slot) focusSlot(slot); return; }
      var found = matching(slot.family, slot);
      slot.truncated = found.truncated;
      found.els.forEach(function (el) {
        var cs = getComputedStyle(el);
        var origPx = parseFloat(cs.fontSize) || 0;
        var entry = { el: el, prev: snapshot(el), origPx: origPx };
        slot.entries.push(entry);
        owner.set(el, slot);
        var decls = declarationsFor(slot, origPx);
        for (var prop in decls) {
          if (!Object.prototype.hasOwnProperty.call(decls, prop)) continue;
          // !important throughout: the page's own stylesheet is usually more
          // specific than an inline rule is strong, and a preview that loses to
          // the site's CSS is not a preview.
          el.style.setProperty(prop, decls[prop], "important");
        }
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
      if (weight !== undefined) slot.styles.weight = weight || "keep";
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

    // Restyle a group this slot ALREADY owns, without re-sweeping the document.
    //
    // apply() has to walk every element on the page to find the group, which is
    // fine once but ruinous sixty times a second while a slider is dragged — on
    // a real site that is the whole DOM per frame. The group is already known
    // here, and each entry carries the size it had before this slot touched it,
    // so the drag costs O(group) and never O(page).
    function restyle(slot) {
      slot.entries.forEach(function (e) {
        restoreAll(e);
        var decls = declarationsFor(slot, e.origPx);
        for (var prop in decls) {
          if (!Object.prototype.hasOwnProperty.call(decls, prop)) continue;
          e.el.style.setProperty(prop, decls[prop], "important");
        }
      });
    }

    // One setter for every typographic control. `null` means "leave the page's
    // own alone" — which is NOT the same as a zero: tracking 0em is a real
    // decision (set this to exactly none) and has to survive as one.
    //
    // `live` is a slider still under the cursor. It takes the fast path AND
    // stays silent: notify() rebuilds the panel, which would tear the slider out
    // of the DOM mid-drag and drop the pointer.
    var NUMERIC = { sizeScale: 1, lineHeight: 1, tracking: 1, wordSpacing: 1 };
    function setStyle(id, key, value, live) {
      var slot = slotById(id);
      if (!slot || !Object.prototype.hasOwnProperty.call(slot.styles, key)) return;
      if (value === null || value === "") slot.styles[key] = (key === "weight") ? "keep" : null;
      else if (NUMERIC[key]) slot.styles[key] = Number(value);
      else if (key === "italic" || key === "smallCaps") slot.styles[key] = !!value;
      else slot.styles[key] = value;
      // The fast path only holds once the group has actually been claimed and
      // the slot is still doing something; anything else needs the full sweep.
      if (live && slot.entries.length && isActive(slot)) { restyle(slot); return; }
      apply(slot);
    }
    // Back to the page's own type for this card, without losing the card or the
    // font you had picked.
    function clearStyles(id) {
      var slot = slotById(id);
      if (!slot) return;
      slot.styles = blankStyles();
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
      if (own) { own.anchor = el; focusSlot(own); return own; }
      var family = core.firstFamily(getComputedStyle(el).fontFamily);
      if (!family) return null;
      for (var i = 0; i < slots.length; i++) if (slots[i].family === family) { slots[i].anchor = el; focusSlot(slots[i]); return slots[i]; }
      var found = matching(family, null);
      var slot = { id: nextId++, family: family, anchor: el, to: null, styles: blankStyles(), count: found.els.length, truncated: found.truncated, source: null, status: "", entries: [] };
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
    // A slider has to start SOMEWHERE, and the honest place is where the page
    // already is — otherwise every control begins at a value the page never had
    // and the first nudge is a jump. Read off the first element in the group,
    // whose entry (after apply) holds its pre-swap size.
    function baseline(slot) {
      // The element you CLICKED, not the first one in document order. A group is
      // not uniform — this page's "Helvetica Neue" spans a 52px headline and an
      // 11px eyebrow tracked at 0.14em — so first-in-DOM makes the sliders open
      // on whichever outlier happens to appear earliest in the markup, which is
      // rarely the thing you were looking at when you clicked.
      // The anchor is valid from the moment you click, long before this slot has
      // applied anything — so it must not be gated on having an entry. The entry
      // is only consulted for the pre-swap SIZE, which is the one number the
      // computed style can no longer answer once a scale has been written.
      var el = slot.anchor;
      if (el && el.isConnected === false) el = null;    // clicked, then re-rendered away
      if (!el) el = slot.entries.length ? slot.entries[0].el : (matching(slot.family, slot).els[0] || null);
      if (!el) return { sizePx: 16, lineHeight: 1.4, tracking: 0 };
      var cs = getComputedStyle(el);
      var entry = ownedEntry(slot, el);
      var px = (entry ? entry.origPx : parseFloat(cs.fontSize)) || 16;
      var lh = parseFloat(cs.lineHeight);
      return {
        sizePx: px,
        // "normal" has no number; ~1.4 is the browser's own rough default and is
        // a better starting handle than 0.
        lineHeight: isNaN(lh) ? 1.4 : +(lh / (parseFloat(cs.fontSize) || px)).toFixed(2),
        tracking: (parseFloat(cs.letterSpacing) || 0) / ((parseFloat(cs.fontSize) || px) || 1)
      };
    }
    function rows() {
      return slots.map(function (s) {
        return {
          id: s.id,
          label: s.family,
          detail: s.count + (s.truncated ? "+" : "") + " element" + (s.count === 1 ? "" : "s"),
          value: s.to || "",
          weights: WEIGHTS,
          styles: {
            weight: s.styles.weight, sizeScale: s.styles.sizeScale, lineHeight: s.styles.lineHeight,
            tracking: s.styles.tracking, wordSpacing: s.styles.wordSpacing,
            transform: s.styles.transform, italic: s.styles.italic, smallCaps: s.styles.smallCaps
          },
          base: baseline(s),
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
        // And WHY, when it is the short list. "insecure" (plain-http page),
        // "unsupported" (browser has no such API), "denied", "prompt" — four
        // causes that look identical on screen and need four different answers.
        // Carried here so a session that cannot see the picker can still say
        // what is wrong.
        fontAccess: accessState(),
        // Null when the real list loaded. Otherwise the actual reason, verbatim.
        fontError: lastEnumError,
        swaps: slots.filter(isActive).map(function (s) {
          var css = declarationsFor(s, baseline(s).sizePx);
          return {
            from: s.family, to: s.to || null,
            weight: s.styles.weight === "keep" ? null : s.styles.weight,
            sizeScale: s.styles.sizeScale, lineHeight: s.styles.lineHeight,
            tracking: s.styles.tracking, wordSpacing: s.styles.wordSpacing,
            transform: s.styles.transform, italic: s.styles.italic, smallCaps: s.styles.smallCaps,
            // The same settings as a CSS block, so the decision can be pasted
            // rather than retyped. font-size is the FIRST element's — a group
            // spans several sizes, and the scale is what actually generalises.
            css: css,
            count: s.count, source: s.source, truncated: !!s.truncated
          };
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
      setFont: setFont, setStyle: setStyle, clearStyles: clearStyles,
      removeSlot: removeSlot, reset: reset, take: take,
      preloadPreview: preloadPreview, loadSystemFonts: loadSystemFonts, catalogueNote: catalogueNote,
      accessState: accessState, refreshPermission: refreshPermission,
      // The gesture path. Re-arms the one-shot guard and goes straight at
      // queryLocalFonts, so a prompt actually appears for Matt to answer.
      requestSystemFonts: function (onDone, ceilingMs) { enumState = "idle"; loadSystemFonts(function () { refreshPermission(onDone); }, ceilingMs); },
      slotCount: function () { return slots.length; }
    };
  }

  return { create: create, WEB_FONTS: WEB_FONTS, LOCAL_CANDIDATES: LOCAL_CANDIDATES, WEIGHTS: WEIGHTS };
});
