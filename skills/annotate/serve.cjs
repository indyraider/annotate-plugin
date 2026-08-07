// Static server for the annotate overlay. Dependency-free, loopback-only.
// The overlay is fetched from here by the page instead of being pasted through
// the agent's context (~24k tokens per run). Dev tool; never exposed publicly.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const TYPES = { ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8" };

function createServer(opts) {
  const root = path.resolve(opts.root);
  return http.createServer(function (req, res) {
    const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const target = path.resolve(path.join(root, rel));

    // Containment check: resolved path must sit inside root.
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403, cors); return res.end("forbidden");
    }
    fs.readFile(target, function (err, buf) {
      if (err) { res.writeHead(404, cors); return res.end("not found"); }
      const type = TYPES[path.extname(target)] || "text/plain; charset=utf-8";
      res.writeHead(200, Object.assign({ "Content-Type": type }, cors));
      res.end(buf);
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = function (name, fallback) {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const root = arg("--root", path.join(__dirname, "overlay"));
  const port = Number(arg("--port", 0));
  const server = createServer({ root: root });
  server.listen(port, "127.0.0.1", function () {
    const p = server.address().port;
    console.log(JSON.stringify({ url: "http://127.0.0.1:" + p + "/", port: p, root: path.resolve(root) }));
  });
}
