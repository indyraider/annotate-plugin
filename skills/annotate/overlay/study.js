// Annotate overlay — study mode. Point at any element on any site and read every
// property that separates expensive-looking UI from ordinary UI — the shadow
// stack, radius, gradient, backdrop blur, letter-spacing, transition curve —
// which the existing 8-property inspector (ui.js) misses entirely. Also
// collects the CSS rules that actually matched, so you see WHY, not just what.
// Read-only: this mode never writes to the page it inspects, only to its own
// chrome (created fresh and appended to <body>, same as ui.js's highlight box).
;(function (root, factory) {
  var core = (typeof module !== "undefined" && module.exports) ? require("./core.js") : (root.__annotatorMods && root.__annotatorMods.core);
  var palette = (typeof module !== "undefined" && module.exports) ? require("./palette.js") : (root.__annotatorMods && root.__annotatorMods.palette);
  var api = factory(core, palette);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.__annotatorMods = root.__annotatorMods || {}; root.__annotatorMods.study = api; }
})(typeof self !== "undefined" ? self : this, function (core, palette) {
  if (!core) throw new Error("annotate: study.js requires core.js to load first");
  if (!palette) throw new Error("annotate: study.js requires palette.js to load first");
  var buildSelector = core.buildSelector;
  var defaultsFor = core.defaultsFor;
  var toTailwind = core.toTailwind;
  var SANS = palette.SANS;
  var MONO = palette.MONO;
  var Z = 2147483647;

  // Chosen because these are what separate expensive-looking UI from ordinary
  // UI. Stack-agnostic by construction: nothing here assumes any framework.
  var PROPS = [
    "display", "position", "flexDirection", "justifyContent", "alignItems", "gap",
    "gridTemplateColumns", "width", "height",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "borderRadius", "borderWidth", "borderStyle", "borderColor", "boxShadow",
    "backgroundColor", "backgroundImage", "backdropFilter", "opacity", "color",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform",
    "transform", "transition", "filter", "zIndex", "overflow"
  ];

  // Read-only: getComputedStyle never mutates `el`.
  function readStyles(el) {
    var cs = getComputedStyle(el);
    var out = {};
    for (var i = 0; i < PROPS.length; i++) { var p = PROPS[i]; out[p] = cs[p]; }
    return out;
  }

  // `styles` minus anything matching the tag's browser defaults — a readout
  // listing `position: static` on every element buries the one that says
  // `sticky`.
  function diffDefaults(tag, styles) {
    var defaults = defaultsFor(tag);
    var out = {};
    for (var k in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, k)) continue;
      if (Object.prototype.hasOwnProperty.call(defaults, k) && defaults[k] === styles[k]) continue;
      out[k] = styles[k];
    }
    return out;
  }

  // A group rule's own label, so the readout can say WHY a matched rule
  // applies (e.g. only at desktop width) — not just that it does.
  function groupLabel(rule) {
    if (rule.media && rule.media.mediaText) return "@media " + rule.media.mediaText;
    if (typeof rule.conditionText === "string") return "@supports " + rule.conditionText;
    if (typeof rule.name === "string") return "@layer" + (rule.name ? " " + rule.name : "");
    return "@import";
  }

  // `rule.selectorText` is undefined for CSSMediaRule/CSSSupportsRule/
  // CSSImportRule/@layer — almost all responsive, dark-mode and @layer CSS
  // in a modern stylesheet lives inside one of these. Recurse into their
  // nested rules (capped at 4 levels — a pathological stylesheet must not
  // hang the readout), carrying the enclosing condition(s) as context.
  function walkRules(rules, el, depth, ctx, out) {
    if (!rules || depth > 4) return;
    for (var j = 0; j < rules.length; j++) {
      var rule = rules[j];
      if (rule.selectorText) {
        try { if (el.matches(rule.selectorText)) out.push({ selector: rule.selectorText, context: ctx.length ? ctx.join(" ") : null }); }
        catch (e2) { continue; }
        continue;
      }
      var nested = null;
      try { nested = rule.cssRules || (rule.styleSheet && rule.styleSheet.cssRules); } catch (e3) { nested = null; }
      if (nested) walkRules(nested, el, depth + 1, ctx.concat(groupLabel(rule)), out);
    }
  }

  // Which CSS rules in the document actually matched this element, and why.
  // Two things bite here, both normal on real sites, neither an error:
  //  - a cross-origin stylesheet (any Google Font, any CDN) throws on .cssRules
  //  - a selector using syntax this browser can't parse throws on .matches()
  // Either must cost us one rule or one sheet, never the whole readout.
  function matchedRules(el) {
    var out = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      walkRules(rules, el, 0, [], out);
    }
    return out;
  }

  function readElement(el) {
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    var r = el.getBoundingClientRect();
    var box = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
    var styles = readStyles(el);
    return {
      tag: tag,
      selector: buildSelector(el),
      box: box,
      styles: styles,
      nonDefault: diffDefaults(tag, styles),
      matchedRules: matchedRules(el),
      tailwind: toTailwind(styles)
    };
  }

  // The design system behind the WHOLE page, not one element. readElement tells
  // you what one card does; this tells you the rules every card on the site
  // follows — palette by frequency, type scale, spacing on a detected grid,
  // radii, shadows, and the author's own custom-property tokens if they used any.
  var PAGE_CAP = 8000;
  var PAGE_SPACING_PROPS = ["gap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
                             "marginTop", "marginRight", "marginBottom", "marginLeft"];

  // rgba(0, 0, 0, 0) / "transparent" are the computed values for "no colour set" —
  // counting them would report the page's biggest "colour" as invisible.
  function isOpaqueColor(v) { return !!v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent"; }

  // Real dark/light token overrides rarely sit on a literal `:root` alone —
  // `:root[data-theme="dark"]`, `.dark`, or `:root, .dark` are the common
  // shapes, and the dark set is often the more interesting one to study. Split
  // on commas: a compound selector list only needs one branch to qualify.
  function isRootSelector(sel) {
    if (!sel) return false;
    var parts = sel.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, "");
      if (p.indexOf(":root") === 0 || p === "html" || p.indexOf(".dark") !== -1 || p.indexOf("[data-theme") !== -1) return true;
    }
    return false;
  }

  // :root's own custom properties — the author's own design tokens — bucketed
  // by the exact selector they were declared under so a themed override is
  // never silently merged into the plain `:root` set. Same guard discipline as
  // matchedRules/walkRules above: a cross-origin stylesheet throws on
  // .cssRules, a malformed rule can throw on .style — either costs one rule,
  // never the whole readout.
  function collectRootProps(rules, depth, out) {
    if (!rules || depth > 4) return;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (isRootSelector(rule.selectorText)) {
        try {
          var style = rule.style;
          var bucket = out[rule.selectorText] || (out[rule.selectorText] = {});
          for (var j = 0; j < style.length; j++) {
            var prop = style[j];
            if (prop.indexOf("--") === 0) bucket[prop] = style.getPropertyValue(prop).trim();
          }
        } catch (e) { /* one malformed rule, not the whole walk */ }
        continue;
      }
      var nested = null;
      try { nested = rule.cssRules || (rule.styleSheet && rule.styleSheet.cssRules); } catch (e2) { nested = null; }
      if (nested) collectRootProps(nested, depth + 1, out);
    }
  }

  function readCustomProps() {
    var out = {};
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      collectRootProps(rules, 0, out);
    }
    var inline = document.documentElement.style;
    for (var k = 0; k < inline.length; k++) {
      var prop = inline[k];
      if (prop.indexOf("--") === 0) {
        var bucket = out["(inline)"] || (out["(inline)"] = {});
        bucket[prop] = inline.getPropertyValue(prop).trim();
      }
    }
    return out;
  }

  // Read-only: getComputedStyle never mutates anything it reads. Capped at
  // PAGE_CAP elements — a silent cap would report a large site's design system
  // as if it were the whole picture with no way to tell; elementsScanned and
  // truncated report the real count either way, honestly, every time.
  function readPage() {
    var els = document.querySelectorAll("*");
    var n = Math.min(els.length, PAGE_CAP);
    var colors = [], sizes = [], weights = [], fonts = [], spacingNums = [], radii = [], shadows = [];
    var scanned = 0;

    for (var i = 0; i < n; i++) {
      var el = els[i];
      // Study must be injected and active for the sweep to run at all, so every
      // real invocation walks past our own chrome (highlight box, inspector
      // card, this panel — all class __ann-ui) too. Left in, our own accent
      // colour/radii/shadows would launder into "the site's" design system.
      if (el.closest && el.closest(".__ann-ui")) continue;
      scanned++;
      var cs = getComputedStyle(el);
      if (isOpaqueColor(cs.color)) colors.push(cs.color);
      if (isOpaqueColor(cs.backgroundColor)) colors.push(cs.backgroundColor);
      if (cs.fontSize) sizes.push(cs.fontSize);
      if (cs.fontWeight) weights.push(cs.fontWeight);
      if (cs.fontFamily) fonts.push(cs.fontFamily);
      for (var p = 0; p < PAGE_SPACING_PROPS.length; p++) {
        var v = parseFloat(cs[PAGE_SPACING_PROPS[p]]);
        if (!isNaN(v) && v > 0) spacingNums.push(v);
      }
      if (cs.borderRadius && cs.borderRadius !== "0px") radii.push(cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== "none") shadows.push(cs.boxShadow);
    }

    return {
      palette: core.tallyValues(colors),
      typeScale: core.tallyValues(sizes),
      weights: core.tallyValues(weights),
      fonts: core.tallyValues(fonts),
      spacing: core.detectScale(spacingNums),
      radii: core.tallyValues(radii),
      shadows: core.tallyValues(shadows),
      customProps: readCustomProps(),
      elementsScanned: scanned,
      truncated: els.length > PAGE_CAP
    };
  }

  // Task 4/5 moves motion to its own module (study.js was already past its
  // line-count guideline). Kept as a stable stub so Task 6 can wire the mode
  // cycle now without waiting on the rest of the phase — no fake data, just an
  // honest "not built yet".
  function readMotion() { return { notImplemented: true }; }

  // ---- readout panel: our own chrome, styled from the host palette so it
  // looks native wherever it lands. Every element here is created fresh and
  // appended to <body> — nothing touches an existing page node, same as the
  // highlight box and inspector card in ui.js. ----
  function createChrome(pal) {
    var panel = document.createElement("div"); panel.className = "__ann-ui";
    // pointerEvents starts at "none": the panel sits 14px from the cursor, close
    // enough that a click meant for the page can land on its footprint, and the
    // browser resolves that hit BEFORE any JS runs — Shift can't rescue a click
    // that never reaches the page element at all. setInteractive(true) (below)
    // flips it back on only while the cursor is actually over it, so scrolling
    // still works but a click aimed at the underlying page always passes through.
    Object.assign(panel.style, {
      position: "fixed", zIndex: Z, display: "none", maxWidth: "320px", maxHeight: "72vh",
      overflow: "auto", pointerEvents: "none", background: pal.elevated, border: "1px solid " + pal.border,
      borderRadius: "8px", padding: "10px 12px", font: "11px/1.6 " + MONO, color: pal.text,
      boxShadow: "0 8px 30px rgba(0,0,0,.4)"
    });
    document.body.appendChild(panel);

    function row(label, value, swatch) {
      var d = document.createElement("div");
      Object.assign(d.style, { display: "flex", gap: "6px", whiteSpace: "nowrap", overflow: "hidden" });
      if (swatch) {
        var s = document.createElement("span");
        Object.assign(s.style, { width: "9px", height: "9px", borderRadius: "2px", flex: "none", border: "1px solid " + pal.hairline, background: swatch });
        d.appendChild(s);
      }
      var k = document.createElement("span"); k.textContent = label;
      Object.assign(k.style, { color: pal.text3, flex: "none", minWidth: "84px" });
      var v = document.createElement("span"); v.textContent = value;
      Object.assign(v.style, { color: pal.text, overflow: "hidden", textOverflow: "ellipsis" });
      d.append(k, v);
      return d;
    }

    function render(data) {
      panel.textContent = "";
      panel.appendChild(row("tag", data.selector || data.tag));
      panel.appendChild(row("box", data.box.width + " × " + data.box.height + " px"));
      var keys = [];
      for (var k in data.nonDefault) if (Object.prototype.hasOwnProperty.call(data.nonDefault, k)) keys.push(k);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], val = data.nonDefault[key];
        panel.appendChild(row(key, String(val), /color$/i.test(key) ? val : null));
      }
      if (data.matchedRules.length) panel.appendChild(row("rules", data.matchedRules.length + " matched"));
      if (data.tailwind.length) panel.appendChild(row("tailwind", data.tailwind.join(" ")));
    }

    function show(x, y) {
      panel.style.display = "block";
      panel.style.left = Math.min(x + 14, window.innerWidth - panel.offsetWidth - 8) + "px";
      panel.style.top = Math.min(y + 14, window.innerHeight - panel.offsetHeight - 8) + "px";
    }
    function hide() { panel.style.display = "none"; }
    function destroy() { if (panel.parentNode) panel.parentNode.removeChild(panel); }

    // mouseenter/mouseleave never fire on a pointer-events:none element (it is
    // never a hit-test target, which is the whole point) — so the flip has to
    // be driven from the page's own mousemove, comparing cursor position against
    // the panel's own rect, not from events on the panel itself.
    function hitTest(x, y) {
      if (panel.style.display === "none") return false;
      var r = panel.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    function setInteractive(v) { panel.style.pointerEvents = v ? "auto" : "none"; }

    return { render: render, show: show, hide: hide, destroy: destroy, hitTest: hitTest, setInteractive: setInteractive };
  }

  // ctx = { pal, ui, state, save, persist, notify } — see index.js (Task 6).
  // Only pal and ui are needed for the readout itself; the rest of the shape
  // is accepted so this module stays a drop-in the same way point.js/measure.js are.
  function create(ctx) {
    var pal = ctx.pal, ui = ctx.ui;
    var chrome = null, pinned = null, lastEl = null;

    function paint(el, x, y) {
      chrome.render(readElement(el));
      chrome.show(x, y);
    }

    // Hover tracks the live readout; a pin (click) freezes it on one element
    // so the panel can be read while the mouse moves elsewhere.
    function onMousemove(e) {
      // Cheap on every move regardless of target — a rect compare, not a readout.
      chrome.setInteractive(chrome.hitTest(e.clientX, e.clientY));
      if (pinned || ui.isOurs(e.target)) return;
      // Same target as last move: skip the readout entirely. matchedRules()
      // walks every stylesheet and every rule via el.matches() — on a real
      // production site that cost scales with the WHOLE site's CSS, and
      // mousemove fires continuously, so re-running it for a target that
      // hasn't changed is pure waste.
      if (e.target === lastEl) return;
      lastEl = e.target;
      ui.showHighlight(e.target);
      paint(e.target, e.clientX, e.clientY);
    }

    // Only `click` is intercepted — unlike point.js, Study leaves
    // pointerdown/mousedown/auxclick alone, because studying a site means
    // clicking through it to reach the page being studied. Shift+click is
    // the same peek convention point.js uses: it bypasses the pin entirely
    // and reaches the real page underneath.
    function onClick(e) {
      if (e.shiftKey) return;
      if (ui.isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (pinned === e.target) { pinned = null; return; }
      pinned = e.target;
      ui.showHighlight(pinned);
      paint(pinned, e.clientX, e.clientY);
    }

    var attached = false;
    function enable() {
      if (attached) return;
      attached = true;
      chrome = createChrome(pal);
      document.addEventListener("mousemove", onMousemove, true);
      document.addEventListener("click", onClick, true);
    }
    function disable() {
      if (!attached) return;
      attached = false;
      document.removeEventListener("mousemove", onMousemove, true);
      document.removeEventListener("click", onClick, true);
      pinned = null; lastEl = null;
      ui.hideHighlight();
      if (chrome) { chrome.destroy(); chrome = null; }
    }

    return { enable: enable, disable: disable, readElement: readElement, readPage: readPage, readMotion: readMotion };
  }

  return { create: create };
});
