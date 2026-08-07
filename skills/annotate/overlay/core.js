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

  return {
    buildSelector: buildSelector, fitDimensions: fitDimensions,
    classifyRequest: classifyRequest, createPerfBuffer: createPerfBuffer,
    findRscEntry: findRscEntry,
  };
});
