// Annotate overlay — core. Pure helpers, no DOM, no page globals.
// Loaded first; every other module reads its dependencies off __annotatorMods.
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.core = api; }
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

  // Pure: box-fit a w×h image inside `max` on its longest side, never upscaling.
  // Attached screenshots are downscaled through this before they're stored — a raw
  // Retina paste is multi-MB base64 and would blow the localStorage quota alone.
  function fitDimensions(w, h, max) {
    if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
    var scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  // Pure: which kind of Next.js request is this, judged only by its headers?
  // Next tags Server Actions with `Next-Action` and RSC navigation payloads with `RSC`.
  // A request carrying both is an action — actions are posted from an already-RSC context.
  // Accepts a Headers instance (whose own .get is case-insensitive) or a plain object.
  function classifyRequest(headers) {
    if (!headers) return null;
    var get = function (name) {
      if (typeof headers.get === "function") return headers.get(name);
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === name) return headers[k];
      }
      return null;
    };
    if (get("next-action")) return "action";
    if (get("rsc")) return "rsc";
    return null;
  }

  // Pure: given the browser's resource timings, did this navigation actually hit the server?
  // Next marks an RSC navigation payload with a `?_rsc=` QUERY PARAM (not a header we can see)
  // and does NOT route it through window.fetch — and it starts the request BEFORE pushState
  // fires. So detection reads resource timings and looks BACKWARD from the moment the URL
  // changed. Returns the matching entry, or null when the click genuinely needed no server
  // request (a client router cache hit).
  function findRscEntry(entries, toUrl, at, lookbackMs) {
    if (!entries || !entries.length) return null;
    var path = String(toUrl).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    for (var i = entries.length - 1; i >= 0; i--) {
      var e = entries[i];
      if (e.startTime < at - lookbackMs) break;          // chronological — nothing older can match
      if (e.name.indexOf("_rsc=") === -1) continue;
      if (e.name.split("?")[0].indexOf(path) === -1) continue;
      return e;
    }
    return null;
  }

  // Pure: bounded FIFO for perf entries. An image-heavy scroll could otherwise hand the
  // agent a payload big enough to bloat its context, so the buffer caps and drops oldest —
  // and reports how many it lost on the next drain, so truncation is never silent.
  function createPerfBuffer(cap) {
    var items = [], dropped = 0;
    return {
      push: function (e) { items.push(e); if (items.length > cap) { items.shift(); dropped++; } },
      drain: function (now) {
        var out = items; items = [];
        if (dropped) { out = [{ t: now, kind: "dropped", n: dropped }].concat(out); dropped = 0; }
        return out;
      },
      size: function () { return items.length; },
    };
  }

  // Pure: frequency-rank a list of values. A page's real palette is the handful
  // of colours used hundreds of times; everything else is noise from one banner.
  function tallyValues(values) {
    if (!values || !values.length) return [];
    var counts = Object.create(null), order = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (counts[v] === undefined) { counts[v] = 0; order.push(v); }
      counts[v]++;
    }
    return order.map(function (v) { return { value: v, count: counts[v] }; })
                .sort(function (a, b) { return b.count - a.count; });
  }

  // Pure: is this set of numbers built on a grid, and what is its unit?
  // The `base >= 2` guard ensures we don't claim a grid when the GCD is 1 —
  // mathematically, 1 divides all numbers, but "these are just numbers" is the
  // honest answer, not a 1px grid. base >= 2 ensures a real spacing system.
  function detectScale(numbers) {
    if (!numbers || !numbers.length) return { base: 0, values: [], onGrid: false };
    var vals = [], seen = {};
    for (var i = 0; i < numbers.length; i++) {
      var n = Math.round(numbers[i]);
      if (n > 0 && !seen[n]) { seen[n] = 1; vals.push(n); }
    }
    vals.sort(function (a, b) { return a - b; });
    if (!vals.length) return { base: 0, values: [], onGrid: false };
    var gcd = function (a, b) { while (b) { var t = b; b = a % b; a = t; } return a; };
    var base = vals[0];
    for (var j = 1; j < vals.length; j++) base = gcd(base, vals[j]);
    var onGrid = base >= 2;
    return { base: base, values: vals, onGrid: onGrid };
  }

  // Pure: browser defaults worth suppressing. Not exhaustive by design — a
  // readout listing `position: static` on every element hides the one that says
  // `sticky`. Tag-specific entries override the shared block defaults.
  var BLOCK_DEFAULTS = {
    display: "block", position: "static", opacity: "1", zIndex: "auto",
    borderRadius: "0px", boxShadow: "none", transform: "none", filter: "none",
    backdropFilter: "none", letterSpacing: "normal", textTransform: "none",
    backgroundImage: "none", flexDirection: "row", overflow: "visible"
  };
  var TAG_DEFAULTS = {
    span: { display: "inline" }, a: { display: "inline" }, em: { display: "inline" },
    strong: { display: "inline" }, img: { display: "inline" }, button: { display: "inline-block" }
  };
  function defaultsFor(tag) {
    var out = {};
    for (var k in BLOCK_DEFAULTS) if (Object.prototype.hasOwnProperty.call(BLOCK_DEFAULTS, k)) out[k] = BLOCK_DEFAULTS[k];
    var t = TAG_DEFAULTS[String(tag).toLowerCase()];
    if (t) for (var j in t) if (Object.prototype.hasOwnProperty.call(t, j)) out[j] = t[j];
    return out;
  }

  // Pure: computed styles -> Tailwind classes. Stock utility where the value is
  // on Tailwind's scale, arbitrary-value syntax otherwise. Users are on Tailwind;
  // raw CSS costs them a hand conversion every time.
  var TW_SPACE = { "0px": "0", "2px": "0.5", "4px": "1", "6px": "1.5", "8px": "2", "10px": "2.5",
                   "12px": "3", "14px": "3.5", "16px": "4", "20px": "5", "24px": "6", "28px": "7",
                   "32px": "8", "40px": "10", "48px": "12", "64px": "16", "80px": "20", "96px": "24" };
  var TW_RADIUS = { "0px": "rounded-none", "2px": "rounded-sm", "4px": "rounded", "6px": "rounded-md",
                    "8px": "rounded-lg", "12px": "rounded-xl", "16px": "rounded-2xl",
                    "24px": "rounded-3xl", "9999px": "rounded-full", "999px": "rounded-full" };
  function toTailwind(s) {
    if (!s) return [];
    var out = [], d = BLOCK_DEFAULTS;
    var space = function (prefix, value) {
      if (!value || value === "0px") return null;
      return TW_SPACE[value] ? prefix + "-" + TW_SPACE[value] : prefix + "-[" + value + "]";
    };
    if (s.display && s.display !== d.display) {
      if (s.display === "flex" || s.display === "grid" || s.display === "inline-flex") out.push(s.display);
      else out.push("[display:" + s.display + "]");
    }
    if (s.position && s.position !== d.position) out.push(s.position);
    if (s.flexDirection === "column") out.push("flex-col");
    if (s.borderRadius && s.borderRadius !== d.borderRadius) {
      out.push(TW_RADIUS[s.borderRadius] || "rounded-[" + s.borderRadius + "]");
    }
    // Uniform padding collapses to p-*; anything else stays per-side.
    var pt = s.paddingTop, pr = s.paddingRight, pb = s.paddingBottom, pl = s.paddingLeft;
    if (pt && pt === pr && pt === pb && pt === pl) { var p = space("p", pt); if (p) out.push(p); }
    else {
      if (pt && pb && pt === pb) { var py = space("py", pt); if (py) out.push(py); }
      else { var a = space("pt", pt), b = space("pb", pb); if (a) out.push(a); if (b) out.push(b); }
      if (pl && pr && pl === pr) { var px = space("px", pl); if (px) out.push(px); }
      else { var c = space("pl", pl), e = space("pr", pr); if (c) out.push(c); if (e) out.push(e); }
    }
    if (s.gap) { var g = space("gap", s.gap); if (g) out.push(g); }
    if (s.boxShadow && s.boxShadow !== d.boxShadow) out.push("shadow-[" + s.boxShadow.replace(/\s+/g, "_") + "]");
    if (s.backdropFilter && s.backdropFilter !== d.backdropFilter) out.push("backdrop-blur-[" + s.backdropFilter + "]");
    if (s.letterSpacing && s.letterSpacing !== d.letterSpacing) out.push("tracking-[" + s.letterSpacing + "]");
    if (s.opacity && s.opacity !== d.opacity) out.push("opacity-[" + s.opacity + "]");
    return out;
  }

  // Pure: does this selector target :root's OWN custom properties — the plain
  // set or a themed override (`:root[data-theme="dark"]`, `.dark`, a compound
  // list like `:root, .dark`)? The dark/themed set is often the more
  // interesting one to someone studying a design, so it must not be dropped.
  // `.dark` only counts as a COMPLETE class — `.darkroom` and
  // `.dark-blue-button` are component names, not theme roots, and matching
  // them as substrings would drag unrelated component styles into the
  // reported tokens as if they were the site's theme set.
  function isRootSelector(sel) {
    if (!sel) return false;
    var parts = sel.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, "");
      if (p.indexOf(":root") === 0) return true;
      if (p === "html") return true;
      if (p === ".dark" || p === ".light") return true;
      if (p.indexOf(".dark.") === 0 || p.indexOf(".dark[") === 0 || p.indexOf(".dark:") === 0) return true;
      if (p.indexOf("[data-theme") !== -1) return true;
    }
    return false;
  }

  return {
    buildSelector: buildSelector, fitDimensions: fitDimensions,
    classifyRequest: classifyRequest, createPerfBuffer: createPerfBuffer,
    findRscEntry: findRscEntry, tallyValues: tallyValues, detectScale: detectScale,
    defaultsFor: defaultsFor, toTailwind: toTailwind, isRootSelector: isRootSelector,
  };
});
