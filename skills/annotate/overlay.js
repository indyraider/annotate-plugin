// Annotate overlay — loader. The implementation lives in overlay/*.js and is
// fetched from the local server (see serve.cjs) rather than pasted through the
// agent's context. Nothing in this repo require()s this file — overlay.test.cjs
// reads it as TEXT, same as the browser does when it's injected. The UMD wrap
// below only matters if something ever does require() it: it would get back
// { boot, FILES }, not a re-export of core.js.
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.__annotatorBoot = api.boot;
})(typeof self !== "undefined" ? self : this, function () {

  var FILES = ["core.js", "palette.js", "ui.js", "point.js", "measure.js", "study-motion.js", "study.js", "index.js"];

  // Fetch each module as TEXT and eval it, rather than importing it as a module.
  // The real reason: one text payload works for both this loader and any future
  // direct injection, with no <script> tag and no module graph to keep in sync.
  //
  // This is NOT a CSP workaround, and is in some ways weaker than direct injection:
  // browser_evaluate runs over CDP and is not subject to page CSP at all, while this
  // path adds a network request that can be refused.
  //
  // Measured 2026-08-07, and it is NOT what the comment here used to claim. CSP does
  // not stop this: all eight modules eval and boot on github.com under
  // `default-src 'none'` with no 'unsafe-eval'. What fails is the fetch below, and the
  // reason is Chrome's Local Network Access permission, not connect-src — it fails the
  // same way on a page with no CSP at all ("Permission was denied for this request to
  // access the `loopback` address space"), and bypassing CSP does not help. From a
  // local origin the same fetch returns 200, which is why the dev app never saw it.
  // The fix is to skip the fetch entirely and inject from disk; see SKILL.md.
  // ponytail: eval of our own source, dev-only.
  function boot(baseUrl) {
    if (typeof window !== "undefined" && window.__annotator) return Promise.resolve("already-running");
    var base = String(baseUrl).replace(/\/?$/, "/");
    try { localStorage.setItem("__ann_boot_url", base); } catch (e) {}
    // In-memory fallback for study-motion.js's fingerprint filter: a sandboxed
    // iframe or storage-blocked context makes localStorage throw on BOTH the
    // write above and the read there, so bootBase would be null, isOwnModuleUrl
    // would exclude nothing, and Study would report its own study-motion.js as
    // a detected motion library on every such page.
    window.__annBootBase = base;
    return FILES.reduce(function (chain, f) {
      return chain.then(function () {
        return fetch(base + f, { cache: "no-store" })
          .then(function (r) {
            if (!r.ok) throw new Error("annotate: " + f + " -> HTTP " + r.status);
            return r.text();
          })
          .then(function (src) { (0, eval)(src); });
      });
    }, Promise.resolve()).then(function () {
      window.__annotatorMods.index.setup();
      return "ready";
    });
  }

  return { boot: boot, FILES: FILES };
});
