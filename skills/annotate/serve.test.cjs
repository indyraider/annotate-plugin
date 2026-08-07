// Self-check for the overlay's static server. Dependency-free.
// Run: node skills/annotate/serve.test.cjs
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createServer } = require("./serve.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ann-serve-"));
fs.writeFileSync(path.join(tmp, "hello.js"), "var x = 1;");
fs.mkdirSync(path.join(tmp, "sub"));
fs.writeFileSync(path.join(tmp, "sub", "deep.js"), "var y = 2;");

function get(port, urlPath) {
  return new Promise(function (resolve) {
    http.get({ host: "127.0.0.1", port: port, path: urlPath }, function (res) {
      let body = "";
      res.on("data", function (c) { body += c; });
      res.on("end", function () { resolve({ status: res.statusCode, headers: res.headers, body: body }); });
    });
  });
}

(async function () {
  const server = createServer({ root: tmp });
  await new Promise(function (r) { server.listen(0, "127.0.0.1", r); });
  const port = server.address().port;

  const ok = await get(port, "/hello.js");
  assert.strictEqual(ok.status, 200, "serves a file");
  assert.strictEqual(ok.body, "var x = 1;", "serves exact bytes");
  assert.strictEqual(ok.headers["access-control-allow-origin"], "*", "CORS header present");
  assert.ok(/javascript/.test(ok.headers["content-type"]), "js content-type");

  const nested = await get(port, "/sub/deep.js");
  assert.strictEqual(nested.status, 200, "serves nested paths");

  const missing = await get(port, "/nope.js");
  assert.strictEqual(missing.status, 404, "404s an unknown file");

  // Path traversal must not escape root — this server binds to loopback but the
  // guard is cheap and the failure mode is handing out arbitrary local files.
  const escaped = await get(port, "/../../../etc/passwd");
  assert.ok(escaped.status === 403 || escaped.status === 404, "refuses traversal, got " + escaped.status);

  // Malformed percent-escapes must not crash the server. A stray % or invalid
  // UTF-8 sequence like %E0%80 throws URIError from decodeURIComponent; verify
  // the server returns 400, keeps the CORS header, and survives to serve again.
  const malformed = await get(port, "/%E0%80");
  assert.strictEqual(malformed.status, 400, "rejects malformed URL");
  assert.strictEqual(malformed.headers["access-control-allow-origin"], "*", "CORS header on 400");
  const survived = await get(port, "/hello.js");
  assert.strictEqual(survived.status, 200, "server survived malformed request");

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("serve.test.cjs — all assertions passed");
})();
