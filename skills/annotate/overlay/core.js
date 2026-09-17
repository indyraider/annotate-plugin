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

  // ---- Compare: baseline vs re-run --------------------------------------
  //
  // Justified by two recorded incidents in this project. Measure mode's first
  // version reported `servedFromCache: true` for every navigation — the exact
  // opposite of the truth — with all sixteen of its unit tests passing. And a
  // headline performance finding once evaporated because it had been measured
  // on the dev server. Before-and-after numbers are how that stops happening,
  // which means these numbers have to be honest about their own weakness.

  // Pure: strip origin, query and hash so the same route pairs across two runs.
  // Next appends `?_rsc=<hash>` to navigation payloads and it differs every
  // time — leave it on and NOTHING ever matches, so every row reads "added" and
  // the comparison silently becomes a list instead of a diff.
  function normalisePath(url) {
    if (url == null) return "";
    return String(url).replace(/^https?:\/\/[^/]+/, "").split("?")[0].split("#")[0] || "/";
  }

  // Pure: the identity a perf entry is paired on across runs. nav/action/img
  // carry a URL worth keeping; shift and longtask have no natural identity, so
  // they aggregate by kind — "the page shifted less than it used to" is the
  // only honest claim available for those.
  function entryKey(e) {
    if (!e || !e.kind) return null;
    if (e.kind === "nav") return "nav " + normalisePath(e.from) + " -> " + normalisePath(e.to);
    if (e.kind === "action") return "action " + normalisePath(e.url);
    if (e.kind === "img") return "img " + normalisePath(e.url);
    if (e.kind === "dropped") return null;              // bookkeeping, not a measurement
    return e.kind;
  }

  // Pure: the one number that means "how bad was it" for each kind. nav prefers
  // the server's own time and falls back to time-to-paint; a cache-served nav
  // has no rscMs at all and toPaintMs is the only thing that happened.
  function entryMetric(e) {
    if (!e) return null;
    if (e.kind === "nav") return e.rscMs != null ? e.rscMs : (e.toPaintMs != null ? e.toPaintMs : null);
    if (e.kind === "shift") return e.value != null ? e.value : null;
    return e.ms != null ? e.ms : null;
  }

  // Pure: entries -> { key: {kind, n, total, mean, min, max} }, plus whether the
  // run was truncated. A `dropped` marker means the 500-entry buffer overflowed,
  // and comparing two runs where one lost entries is comparing different things
  // — silent truncation cost this project 7920 automation runs once.
  function summariseRun(entries) {
    var byKey = Object.create(null), truncated = false, dropped = 0;
    (entries || []).forEach(function (e) {
      if (e && e.kind === "dropped") { truncated = true; dropped += (e.n || 0); return; }
      var key = entryKey(e), m = entryMetric(e);
      if (key === null || m === null || isNaN(m)) return;
      var s = byKey[key] || (byKey[key] = { key: key, kind: e.kind, n: 0, total: 0, min: m, max: m, mean: 0 });
      s.n++; s.total += m;
      if (m < s.min) s.min = m;
      if (m > s.max) s.max = m;
      s.mean = s.total / s.n;
    });
    return { byKey: byKey, truncated: truncated, dropped: dropped };
  }

  // Pure: baseline vs current. Every key in either run lands in exactly one row.
  //
  // Two noise floors, and BOTH must be cleared before anything is called faster
  // or slower. 4ms off a 20ms action is 20% and still noise; 400ms off a 30s
  // upload is a big number and still noise. Requiring both is what stops this
  // reporting a win that a second run would not reproduce.
  function compareRuns(baselineEntries, currentEntries, opts) {
    opts = opts || {};
    var minMs = opts.minMs != null ? opts.minMs : 5;
    var minPct = opts.minPct != null ? opts.minPct : 0.1;
    var before = summariseRun(baselineEntries), after = summariseRun(currentEntries);
    var keys = [], seen = Object.create(null);
    [before.byKey, after.byKey].forEach(function (m) {
      for (var k in m) if (!seen[k]) { seen[k] = 1; keys.push(k); }
    });
    var rows = keys.map(function (k) {
      var b = before.byKey[k] || null, a = after.byKey[k] || null;
      var row = { key: k, kind: (b || a).kind, before: b, after: a, deltaMs: null, deltaPct: null, verdict: "", thin: false };
      if (!b) { row.verdict = "added"; return row; }
      if (!a) { row.verdict = "gone"; return row; }
      row.deltaMs = a.mean - b.mean;
      row.deltaPct = b.mean === 0 ? null : row.deltaMs / b.mean;
      // A single observation on either side is an anecdote. Say so on the row
      // rather than letting a reader treat "38% faster" from one sample each as
      // a measurement — this is the same mistake as the dev-server finding.
      row.thin = b.n < 2 || a.n < 2;
      var clearsAbs = Math.abs(row.deltaMs) >= minMs;
      var clearsPct = row.deltaPct === null ? true : Math.abs(row.deltaPct) >= minPct;
      if (!clearsAbs || !clearsPct) row.verdict = "same";
      else row.verdict = row.deltaMs > 0 ? "slower" : "faster";
      return row;
    });
    // Worst regression first: that is the thing the run was done to find.
    rows.sort(function (x, y) {
      var rank = { slower: 0, added: 1, faster: 2, same: 3, gone: 4 };
      if (rank[x.verdict] !== rank[y.verdict]) return rank[x.verdict] - rank[y.verdict];
      return (y.deltaMs || 0) - (x.deltaMs || 0);
    });
    return {
      rows: rows,
      regressions: rows.filter(function (r) { return r.verdict === "slower"; }),
      // Never let a truncated run read as a complete one.
      truncated: before.truncated || after.truncated,
      dropped: { before: before.dropped, after: after.dropped },
      thresholds: { minMs: minMs, minPct: minPct }
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

  // Pure: is this resource URL one of the overlay's OWN modules? The loader
  // fetches every module (including study-motion.js) INSIDE the inspected
  // page's JS context, so Resource Timing records them as real entries on the
  // page being studied — every single session, on every site. study-motion.js's
  // network fingerprint regex matches the bare word "motion", which matches its
  // own filename, so without this filter Study reports a spurious "motion
  // library detected" unconditionally. Primary signal: the URL starts with the
  // stored boot base (exact match — this is how the loader actually fetches
  // each file, `base + filename`). Secondary guard, SAME-ORIGIN ONLY: the
  // module basenames (index.js, core.js, ...) are generic enough that a real
  // site could legitimately serve one under a different origin, so basename
  // alone must never disqualify a resource — only when it also shares the boot
  // origin. No boot base -> always false: an unknown boot origin must never
  // start excluding real site resources.
  var OWN_MODULE_FILES = ["core.js", "palette.js", "fontpicker.js", "fontspanel.js", "ui.js", "point.js", "measure.js", "study-motion.js", "study.js", "fonts.js", "index.js"];
  function isOwnModuleUrl(url, bootBase) {
    if (!bootBase || !url) return false;
    var u = String(url), base = String(bootBase);
    if (u.indexOf(base) === 0) return true;
    var originOf = function (s) { var m = /^[a-z]+:\/\/[^/]+/i.exec(s); return m ? m[0] : null; };
    var baseOrigin = originOf(base);
    if (!baseOrigin || originOf(u) !== baseOrigin) return false;
    var basename = u.split("?")[0].split("/").pop();
    return OWN_MODULE_FILES.indexOf(basename) !== -1;
  }

  // Pure: does this resource URL name a motion library — judged by its
  // BASENAME with word boundaries, never a raw substring test on the whole
  // URL. A bare "motion" substring happily matches /assets/promotions.js,
  // promotion-banner.css, and emotion.js (the CSS-in-JS library, unrelated to
  // motion) — and "promotions" is near-universal on ecommerce/marketing
  // sites, precisely the population Study exists to study. Basename +
  // boundary keeps `motion.abc.js`/`framer-motion.chunk.js` matching while
  // rejecting `promotions.js`/`emotion.js`/`promotion-banner.css`.
  var MOTION_FINGERPRINT_RE = /(^|[^a-z])(gsap|three|lottie|framer-motion|motion|anime|lenis|locomotive)([^a-z]|$)/i;
  function isMotionFingerprintUrl(url) {
    if (!url) return false;
    var basename = String(url).split("?")[0].split("/").pop();
    return MOTION_FINGERPRINT_RE.test(basename);
  }

  // Pure: distance between a studied value and one scale token. Numeric on both
  // sides (the normal px/scale case) -> plain difference. Otherwise (a shadow
  // string, say) there is no meaningful "close" — two different shadow strings
  // don't have a distance, they either match or they don't — so it's 0 on exact
  // equality and Infinity otherwise. Infinity is what keeps a non-numeric
  // mismatch from ever being misread as a near-miss conflict below.
  //
  // A studied value arrives as the CSS literal the readout produced — "20px",
  // not 20 — and Number("20px") is NaN, so a unit-bearing value used to fall
  // straight to the string branch, miss every numeric token in the scale and
  // come back "new". That is the UNSAFE direction this whole classifier exists
  // to lean away from: "new" silently adds a second token doing the job of one
  // the user already has. Only a PURE dimension is unwrapped — "0 8px 30px
  // rgba(0,0,0,.12)" must stay one opaque string, or a shadow would parse to
  // the number 0 and start reporting numeric distances to other shadows.
  var DIMENSION = /^\s*(-?\d*\.?\d+)\s*(px|rem|em|%|ms|s|vh|vw)?\s*$/;
  function parseDimension(v) {
    if (typeof v === "number") return isNaN(v) ? null : { n: v, unit: "" };
    var m = DIMENSION.exec(String(v));
    return m ? { n: Number(m[1]), unit: m[2] || "" } : null;
  }
  // Pure: the next mode in the keyboard rotation. "off" is always first, so the
  // rotation always passes back through a state where the page is usable — a
  // cycle of modes only would leave no way to just USE the site being studied.
  // `enabledKeys` comes from the toolbar's own list minus anything disabled, so
  // a mode that ships greyed out can never become a dead stop in the rotation.
  // An unrecognised current mode returns "off" (indexOf -1 -> index 0), which is
  // the safe direction: worst case the user presses the key once more.
  function nextMode(current, enabledKeys) {
    var cycle = ["off"].concat(enabledKeys || []);
    return cycle[(cycle.indexOf(current) + 1) % cycle.length];
  }

  // Pure: is this computed value the ABSENCE of a decision rather than one?
  // The computed-style read answers every property whether or not the author
  // set it, so a studied element hands back `boxShadow: "none"`, `paddingTop: "0px"`
  // for the overwhelmingly common case of "there isn't one". Fed to reconcile
  // those arrive as adoptable tokens, and the promote step asks the user to
  // adopt `shadow: none` into their design language — noise that buries the two
  // or three values that are real decisions. Callers filter with this; it is
  // deliberately NOT applied inside reconcile, because "no shadow, on purpose"
  // is occasionally a real decision and only the user can say which it is.
  function isAbsentValue(v) {
    if (v == null || v === "") return true;
    var s = String(v).trim().toLowerCase();
    return s === "none" || s === "normal" || s === "auto" || s === "0" || s === "0px" ||
           s === "0%" || s === "0s" || s === "0ms" || s === "rgba(0, 0, 0, 0)" || s === "transparent";
  }

  // Every numeric read of a scale token goes through this, not bare Number().
  // A scale is just as likely to be written ["6px","10px","16px"] as [6,10,16],
  // and one bare Number() left behind is enough to turn the whole comparison
  // to NaN and hand back the unsafe "new".
  function toNumber(v) { var d = parseDimension(v); return d ? d.n : NaN; }
  function tokenDistance(value, token) {
    var a = parseDimension(value), b = parseDimension(token);
    // Two explicit but DIFFERENT units aren't comparable without a root font
    // size we don't have. Infinity says so honestly; treating 1.5rem as 18.5
    // away from 20px would invent a conflict out of a unit mismatch.
    if (a && b) return (a.unit && b.unit && a.unit !== b.unit) ? Infinity : Math.abs(a.n - b.n);
    return value === token ? 0 : Infinity;
  }

  // Pure: the span of a numeric scale (max - min, ignoring any non-numeric
  // tokens). Used below as the fallback denominator when the nearest token
  // is 0 and dividing by the token itself would be meaningless.
  function scaleRange(scale) {
    var min = null, max = null;
    for (var i = 0; i < scale.length; i++) {
      var n = toNumber(scale[i]);
      if (isNaN(n)) continue;
      if (min === null || n < min) min = n;
      if (max === null || n > max) max = n;
    }
    return min === null ? 0 : max - min;
  }

  // Pure: the scale token nearest a studied value, and how far away it is.
  // Tie-break on equal distance is the smaller numeric token, not "whichever
  // came first in the array" — array order is not part of a design language,
  // so the same value against the same scale must classify the same way no
  // matter how the caller happened to order it.
  function nearestInScale(value, scale) {
    if (!scale || !scale.length) return null;
    var best = null;
    for (var i = 0; i < scale.length; i++) {
      var d = tokenDistance(value, scale[i]);
      if (best === null || d < best.distance ||
          (d === best.distance && toNumber(scale[i]) < toNumber(best.value))) {
        best = { value: scale[i], distance: d };
      }
    }
    return best;
  }

  // Pure: fits / new / conflict — the decision the whole reconcile feature
  // rests on. The asymmetry is deliberate: wrong toward "conflict" costs the
  // user one decision (adapt to the existing token, or keep both); wrong toward
  // "new" silently adds a second token doing the same job as one that already
  // exists, which is how a scale rots. So a borderline case must land on
  // "conflict" — the new-token cutoff is "MORE THAN `threshold` away", not "at
  // least `threshold` away".
  // A scale with fewer than two entries isn't a scale yet — "close to it" isn't
  // a meaningful claim, so it's forced to "new" rather than manufacturing a
  // false conflict out of a single existing value.
  function classifyValue(value, scale, opts) {
    opts = opts || {};
    // 0.25, relaxed from 0.5 on Matt's ruling 2026-08-07. The reason matters
    // more than the number: this tool is for INSPIRATION, not transcription —
    // "I like that card's corners, use it as a starting point". Under that use,
    // a value landing near an existing token is the NORMAL case and mostly wants
    // adapting to what he already has, not a decision. A warning that fires on
    // every near-miss is a warning he learns to click past, which is worse than
    // one that fires less often and means something.
    var threshold = opts.threshold != null ? opts.threshold : 0.25;
    var nearest = nearestInScale(value, scale);
    if (nearest && nearest.distance === 0) return { verdict: "fits", nearest: nearest, suggestion: null };
    if (!scale || scale.length < 2) return { verdict: "new", nearest: nearest, suggestion: null };
    // Infinity means the two values don't even compare (non-numeric mismatch) —
    // there is nothing to measure "close" against, so it can only be new.
    if (!nearest || nearest.distance === Infinity) return { verdict: "new", nearest: nearest, suggestion: null };
    var base = Math.abs(toNumber(nearest.value));
    // A token of 0 breaks distance/base: ANY nonzero distance divided by 0 is
    // Infinity, so a value sitting right next to a 0 token always read as
    // "new" — the unsafe direction, since the whole point of this classifier
    // is that borderline cases must lean "conflict". Fall back to the scale's
    // own spread instead: the same 4px that's noise against a 0..999 range is
    // a real jump against a 0..8 range.
    var ratio = base > 0 ? nearest.distance / base
      : (function () { var range = scaleRange(scale); return range > 0 ? nearest.distance / range : Infinity; })();
    if (ratio > threshold) return { verdict: "new", nearest: nearest, suggestion: null };
    return {
      verdict: "conflict",
      nearest: nearest,
      suggestion: value + " is close to the existing " + nearest.value + " (off by " + nearest.distance +
        ") — adapt to " + nearest.value + ", or keep both as distinct tokens?"
    };
  }

  // Pure: a whole study's readout against the whole design language, bucketed.
  // Every key the study carries (radii, spacing, shadows, ...) is looked up by
  // the SAME key in the language; a key the language doesn't have yet is just
  // an empty scale, which classifyValue already resolves to "new" via its
  // <2-entries rule — no separate "unknown category" case needed. Every value
  // must land in exactly one bucket: one that fell through all three would be a
  // silently lost user decision.
  function reconcile(study, language, opts) {
    study = study || {};
    language = language || {};
    var out = { fits: [], adopt: [], conflicts: [] };
    for (var key in study) {
      if (!Object.prototype.hasOwnProperty.call(study, key)) continue;
      var values = study[key];
      // A scalar (a bare number, e.g. opacity: 0.5) has no .length, so the
      // loop below would silently iterate zero times and the value would
      // vanish with no error — exactly the "silently lost user decision" this
      // function exists to prevent. Wrap it as one-element rather than drop
      // it. A bare STRING also has .length, so without Array.isArray it would
      // iterate character-by-character and shred "abc" into three fake tokens
      // — Array.isArray is what keeps a string a single value.
      if (values == null) continue;
      if (!Array.isArray(values)) values = [values];
      var scale = language[key] || [];
      for (var i = 0; i < values.length; i++) {
        var value = values[i];
        var result = classifyValue(value, scale, opts);
        var entry = { key: key, value: value, nearest: result.nearest, suggestion: result.suggestion };
        if (result.verdict === "fits") out.fits.push(entry);
        else if (result.verdict === "conflict") out.conflicts.push(entry);
        else out.adopt.push(entry);
      }
    }
    return out;
  }

  // Pure: the first real family name out of a computed `font-family` value.
  // Fonts mode groups elements by "which font is this in", and this is the group
  // key — so a wrong answer silently merges two slots or splits one in half,
  // with nothing on screen to say so.
  //
  // The regex, rather than split(",")[0], is for one case: a family name may
  // legally CONTAIN a comma as long as it is quoted ("Foo, Bar"). Rare, but a
  // half-name group key matches no elements at all, so the swap just appears
  // dead. The three alternatives are, in order: a double-quoted string with
  // escapes, a single-quoted one, anything up to the first comma.
  //
  // A bare generic ("sans-serif") is deliberately returned as-is and NOT
  // rejected: everything that inherited the page default really is one font,
  // and on a lightly-styled page that is the group you most want to click.
  var FIRST_FAMILY_RE = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]*)/;
  // ---- Phase 3: element -> source on React 19 ----
  //
  // React 19 removed fiber._debugSource, so Point's source lookup returned null
  // on every comment. What React 19 keeps is fiber._debugStack, an Error whose
  // third line is the compiled JSX call site. Next's dev server maps a compiled
  // site back to a file through the endpoint its own error overlay uses. These
  // four helpers are the pure half of that; point.js does the fetching.

  // Pure: the JSX call site off a _debugStack string, in the frame shape Next's
  // endpoint takes. Line 2, because 0 is React's marker and 1 is React's own
  // JSX helper.
  function parseDebugStack(stack) {
    var line = String(stack || "").split("\n")[2];
    if (!line) return null;
    var m = /^at (?:(\S+) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m) return null;
    return { file: m[2], line1: Number(m[3]), column1: Number(m[4]), methodName: m[1] || "", arguments: [] };
  }

  // Pure: Next's build directory, read off a server component's frame. Nothing
  // else on the page says where it is, and client frames need it (below).
  function nextDistDir(file) {
    var m = /^about:\/\/React\/Server\/file:\/\/(\/.+?)\/server\//.exec(String(file || ""));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Pure: a client chunk URL rewritten into the dist dir, the way Next's own
  // parseStack does it server-side. Sent as an http URL the endpoint answers
  // "Unknown url scheme 'http'". Percent-decoded: measured, %40 fails and @ works.
  function toNextFrameFile(file, distDir) {
    var s = String(file || "");
    var m = /^https?:\/\/[^/]+\/_next(\/static\/[^?#]+)/.exec(s);
    if (!m || !distDir) return s;
    return "file://" + distDir + decodeURIComponent(m[1]);
  }

  // Pure: the nearest frame in the app's own code. Results arrive in walk order
  // (the element first, then its ancestors), and the element itself is usually
  // a library component whose file is useless to the person fixing the page.
  //
  // `usedFrom` is the next two app files up the tree. The nearest frame is often
  // a shared wrapper (measured on /login: the email field resolves to
  // src/components/ui/input.tsx), while "make this field wider" usually means the
  // file that placed THIS one (src/components/auth/login-form.tsx).
  function firstAppFrame(results) {
    var list = results || [], hit = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var f = r && r.status === "fulfilled" && r.value && r.value.originalStackFrame;
      if (!f || !f.file || f.file.charAt(0) === "<" || /(^|\/)node_modules\//.test(f.file)) continue;   // "<anonymous>" is no file
      if (!hit) { hit = { file: f.file, line: f.line1, column: f.column1, usedFrom: [] }; continue; }
      var seen = f.file === hit.file || hit.usedFrom.some(function (u) { return u.file === f.file; });
      if (!seen) hit.usedFrom.push({ file: f.file, line: f.line1 });
      if (hit.usedFrom.length === 2) break;
    }
    return hit;
  }

  // Pure: a capped log a comment can ask "what happened in the last N seconds?".
  // since() hands out copies: a comment's saved context must not change later.
  function createRecentLog(cap) {
    var items = [];
    return {
      push: function (e) { items.push(e); if (items.length > cap) items.shift(); },
      since: function (t) {
        return items.filter(function (e) { return e.t >= t; }).map(function (e) {
          var c = {}; for (var k in e) c[k] = e[k]; return c;
        });
      }
    };
  }

  function firstFamily(value) {
    if (!value) return "";
    var m = FIRST_FAMILY_RE.exec(String(value));
    var raw = (m ? m[1] : "").trim();
    var quote = raw.charAt(0);
    if ((quote === '"' || quote === "'") && raw.charAt(raw.length - 1) === quote && raw.length > 1) {
      raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    return raw.trim();
  }

  return {
    buildSelector: buildSelector, fitDimensions: fitDimensions,
    classifyRequest: classifyRequest, createPerfBuffer: createPerfBuffer,
    findRscEntry: findRscEntry, tallyValues: tallyValues, detectScale: detectScale,
    defaultsFor: defaultsFor, toTailwind: toTailwind, isRootSelector: isRootSelector,
    isOwnModuleUrl: isOwnModuleUrl, isMotionFingerprintUrl: isMotionFingerprintUrl,
    nearestInScale: nearestInScale, classifyValue: classifyValue, reconcile: reconcile,
    isAbsentValue: isAbsentValue, nextMode: nextMode, firstFamily: firstFamily,
    normalisePath: normalisePath, entryKey: entryKey, entryMetric: entryMetric,
    summariseRun: summariseRun, compareRuns: compareRuns,
    parseDebugStack: parseDebugStack, nextDistDir: nextDistDir,
    toNextFrameFile: toNextFrameFile, firstAppFrame: firstAppFrame,
    createRecentLog: createRecentLog,
  };
});
