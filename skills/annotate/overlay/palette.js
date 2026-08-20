// Annotate overlay — palette. A fixed dark chrome palette and one UI typeface.
//
// This USED to derive itself from the host page's computed background and text,
// so the toolbar looked native on whatever site it was injected into. Matt's
// call, 2026-08-20: hardcode it. The tool is his, it is always the same tool,
// and a chrome that changes colour depending on which site it landed on is a
// chrome you have to re-read every time. A fixed dark panel with a real border
// and a real shadow reads as "this is the tool, not the page" on a white site
// and a black one alike — which is the actual job.
//
// What that removed is worth naming, so it is not rediscovered as a regression:
// the canvas-based luminance probe, the light/dark inference from text colour,
// and the color-mix() ramp. All of it existed to answer "is this page light or
// dark", and nothing asks any more.
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.palette = api; }
})(typeof self !== "undefined" ? self : this, function () {
  // One typeface for the whole overlay, Geist, with a real fallback stack rather
  // than a bare name — it is NOT installed on this machine (checked: the system
  // font list has no Geist; Figma offers it because Figma serves Google Fonts),
  // so ui.js loads it from Google and everything degrades to the system UI face
  // until it arrives, or permanently on a site whose CSP refuses the request.
  //
  // There is deliberately no MONO any more. The overlay used a monospace face
  // for every measured value; the alignment that bought is available from Geist
  // directly through `font-variant-numeric: tabular-nums`, which ui.js sets on
  // the whole chrome. One typeface, and figures that still line up in a column.
  var SANS = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
  var FONT_FAMILY = "Geist";
  var FONT_CSS_URL = "https://fonts.googleapis.com/css?family=Geist:300,400,500,600,700&display=swap";

  // ACCENT is the tool's signature and survives the rewrite unchanged — it is
  // what makes a highlight on the page read as ours.
  var ACCENT = "#ff6f5e", ACCENT_FG = "#1c1206";

  // Neutrals, cool rather than pure grey, so the coral accent sits on them
  // without going muddy. Every one is opaque except the two border tones, which
  // are alpha on purpose: a hairline that is a real colour shifts visibly
  // wherever two panels overlap.
  var DARK = {
    elevated: "#1c1c21",   // panels and popovers
    surface:  "#16161a",   // the ground behind them
    surface2: "#26262c",   // cards, inputs, the pressed state of a tab
    hover:    "#33333c",   // hover, and the slider track
    border:   "rgba(255,255,255,0.11)",
    hairline: "rgba(255,255,255,0.06)",
    // Both muted tones are set by CONTRAST, not by eye. text3 carries the 10-11px
    // labels — "Case", "Size", the element counts — which is the smallest text in
    // the tool, and at its first value it measured 3.08:1 against a card. These
    // clear 4.5:1 on every surface above; overlay.test.cjs computes it rather
    // than trusting the comment.
    text:     "#f2f2f5",
    text2:    "#b6b6c2",
    text3:    "#93939f",
    accent:      ACCENT,
    accentFg:    ACCENT_FG,
    accentSoft:  "rgba(255,111,94,0.14)"
  };

  // Still a function, and still called once at setup, because every consumer
  // takes `pal` as an argument and a constant would freeze that shape into
  // twenty call sites. Returns a copy so a caller cannot mutate the palette out
  // from under the rest of the chrome.
  function build() {
    var out = {};
    for (var k in DARK) if (Object.prototype.hasOwnProperty.call(DARK, k)) out[k] = DARK[k];
    return out;
  }

  return {
    build: build, SANS: SANS,
    FONT_FAMILY: FONT_FAMILY, FONT_CSS_URL: FONT_CSS_URL,
    ACCENT: ACCENT, ACCENT_FG: ACCENT_FG
  };
});
