// Annotate overlay — loader. The implementation lives in overlay/*.js and is
// fetched from the local server (see serve.cjs) rather than pasted through the
// agent's context. Node still requires this file for the self-check, where it
// re-exports core so existing callers keep working.
;(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.__annotatorBoot = api.boot;
})(typeof self !== "undefined" ? self : this, function () {

  var FILES = ["core.js", "palette.js", "ui.js", "point.js", "measure.js", "index.js"];

  // Fetch each module as TEXT and eval it, rather than importing it as a module.
  // A strict site's CSP can block a cross-origin script import outright; text
  // fetched and eval'd goes through the same door the agent's direct injection
  // uses, so one source works for both. ponytail: eval of our own source, dev-only.
  function boot(baseUrl) {
    if (typeof window !== "undefined" && window.__annotator) return Promise.resolve("already-running");
    var base = String(baseUrl).replace(/\/?$/, "/");
    try { localStorage.setItem("__ann_boot_url", base); } catch (e) {}
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
