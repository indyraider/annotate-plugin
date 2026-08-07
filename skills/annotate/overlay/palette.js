// Annotate overlay — palette. Derives a chrome palette from the HOST page's own
// computed colors, so the overlay looks native on whatever site it's injected into.
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.palette = api; }
})(typeof self !== "undefined" ? self : this, function () {
  var SANS = "system-ui, -apple-system, Segoe UI, sans-serif";
  var MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

  // ---- adaptive palette derived from the host page ----
  // ACCENT is the tool's own signature color (the one thing that stays constant
  // across apps). Everything else is mixed from the page's real bg/text.
  var ACCENT = "#ff6f5e", ACCENT_FG = "#1c1206";
  var mix = function (base, other, pct) { return "color-mix(in srgb, " + base + ", " + other + " " + pct + "%)"; };

  // Pure: which background to assume when the page gives us none. A page whose
  // text is dark is a LIGHT page — the text colour is the signal that survives
  // when the background does not.
  var LIGHT_FALLBACK = "rgb(250,250,250)", DARK_FALLBACK = "rgb(24,24,27)";
  function fallbackBg(textLum) { return textLum < 0.5 ? LIGHT_FALLBACK : DARK_FALLBACK; }

  // Robust luminance via canvas — resolves any CSS color format (rgb/hex/named/
  // lab/oklch) to real sRGB bytes. String-parsing misreads modern lab()/oklch()
  // channel ranges. The canvas is one we created; never a canvas on the page
  // being studied, because getContext() binds it permanently.
  function luminance(color, fallback) {
    try {
      var cv = document.createElement("canvas"); cv.width = cv.height = 1;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#808080"; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      var px = ctx.getImageData(0, 0, 1, 1).data;
      return (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255;
    } catch (e) { return fallback; }
  }

  function build() {
    var pick = function (cs, prop, fallback) { var c = cs && cs[prop]; return (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") ? fallback : c; };
    var b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
    var text = pick(b, "color", pick(h, "color", "rgb(237,237,237)"));
    // `null` here means "neither html nor body paints a background" — which is
    // the COMMON case, not an edge one: most sites paint theirs on a wrapper div.
    // This used to fall back to a hard-coded dark, which put the page's own BLACK
    // text on a DARK panel and made the whole toolbar unreadable on every light
    // site built that way (stripe.com is one). Infer from the text instead.
    var bgRaw = pick(b, "backgroundColor", pick(h, "backgroundColor", null));
    var bg = bgRaw || fallbackBg(luminance(text, 0.9));
    var lum = luminance(bg, 0.11);
    var up = lum < 0.5 ? "white" : "black"; // lift surfaces toward this
    return {
      elevated: mix(bg, up, 8), surface: mix(bg, up, 3), surface2: mix(bg, up, 14), hover: mix(bg, up, 20),
      border: mix(text, "transparent", 80), hairline: mix(text, "transparent", 90),
      text: text, text2: mix(text, "transparent", 32), text3: mix(text, "transparent", 52),
      accent: ACCENT, accentFg: ACCENT_FG, accentSoft: "color-mix(in srgb, " + ACCENT + " 14%, transparent)"
    };
  }

  return { build: build, fallbackBg: fallbackBg, SANS: SANS, MONO: MONO, ACCENT: ACCENT, ACCENT_FG: ACCENT_FG };
});
