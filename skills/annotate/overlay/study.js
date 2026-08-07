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
      for (var j = 0; j < rules.length; j++) {
        var rule = rules[j];
        if (!rule.selectorText) continue;
        try { if (el.matches(rule.selectorText)) out.push(rule.selectorText); }
        catch (e2) { continue; }
      }
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

  // Tasks 3 and 4. Kept as a stable stub so Task 6 can wire the mode cycle now
  // without waiting on the rest of the phase — no fake data, just an honest
  // "not built yet".
  function readPage() { return { notImplemented: true }; }
  function readMotion() { return { notImplemented: true }; }

  // ---- readout panel: our own chrome, styled from the host palette so it
  // looks native wherever it lands. Every element here is created fresh and
  // appended to <body> — nothing touches an existing page node, same as the
  // highlight box and inspector card in ui.js. ----
  function createChrome(pal) {
    var panel = document.createElement("div"); panel.className = "__ann-ui";
    Object.assign(panel.style, {
      position: "fixed", zIndex: Z, display: "none", maxWidth: "320px", maxHeight: "72vh",
      overflow: "auto", background: pal.elevated, border: "1px solid " + pal.border,
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

    return { render: render, show: show, hide: hide, destroy: destroy };
  }

  // ctx = { pal, ui, state, save, persist, notify } — see index.js (Task 6).
  // Only pal and ui are needed for the readout itself; the rest of the shape
  // is accepted so this module stays a drop-in the same way point.js/measure.js are.
  function create(ctx) {
    var pal = ctx.pal, ui = ctx.ui;
    var chrome = null, pinned = null;

    function paint(el, x, y) {
      chrome.render(readElement(el));
      chrome.show(x, y);
    }

    // Hover tracks the live readout; a pin (click) freezes it on one element
    // so the panel can be read while the mouse moves elsewhere.
    function onMousemove(e) {
      if (pinned || ui.isOurs(e.target)) return;
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
      pinned = null;
      ui.hideHighlight();
      if (chrome) { chrome.destroy(); chrome = null; }
    }

    return { enable: enable, disable: disable, readElement: readElement, readPage: readPage, readMotion: readMotion };
  }

  return { create: create };
});
