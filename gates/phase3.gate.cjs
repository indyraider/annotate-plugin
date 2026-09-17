// Phase 3 real-browser gate. Drives Chromium against the Tideswell dev server's
// public /login page (React 19.2 + Next 16 Turbopack dev), boots the overlay the
// way SKILL.md does, and proves each Phase 3 behaviour end to end. Unit tests
// cannot: every one of these depends on a live React tree, a live dev server,
// or a real screenshot.
//
// Run from the repo root, with `next dev` up on :3000:
//   PLAYWRIGHT=/Users/mattjones/Documents/brandscout-enterprise/node_modules/.pnpm/@playwright+test@1.60.0/node_modules/playwright \
//     node gates/phase3.gate.cjs
//
// Lives outside skills/ on purpose: skills/annotate is copied into consuming
// projects, and this file is for this repo only.
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const BASE = process.env.GATE_URL || "http://localhost:3000";
const APP = process.env.GATE_APP || "/Users/mattjones/Documents/brandscout-enterprise";
const OVERLAY = path.join(__dirname, "..", "skills", "annotate", "overlay");
const FILES = ["core.js", "palette.js", "fontpicker.js", "fontspanel.js", "ui.js", "point.js", "measure.js", "study-motion.js", "study.js", "fonts.js", "index.js"];
const INPUT = 'main input:not([type="hidden"])';

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

// Clicking the active tab LEAVES the mode (Phase 2), so only click when changing.
// The Phase 3 Compare gate lost an afternoon to exactly this.
async function setMode(page, key) {
  await page.evaluate((k) => {
    if (window.__annotator.mode !== k) document.querySelector('[data-ann-mode="' + k + '"]').click();
  }, key);
}

// Real mouse click -> comment box -> type -> save -> wait for the agent-facing
// annotation. opts.modifiers passes through to the click; opts.beforeType runs
// with the comment box open and focused.
async function comment(page, selector, text, opts = {}) {
  await setMode(page, "on");
  await page.click(selector, opts.modifiers ? { modifiers: opts.modifiers } : {});
  await page.waitForSelector(".__ann-ui textarea");
  if (opts.beforeType) await opts.beforeType();
  await page.fill(".__ann-ui textarea", text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const anns = await page.evaluate(() => window.__annotatorWait(5000));
  assert.strictEqual(anns.length, 1, "exactly one annotation arrived for '" + text + "', got " + anns.length);
  return anns[0];
}

// ---- checks ----

check("a comment on a server component carries its exact source file", async (page) => {
  const a = await comment(page, "main h1", "gate: server source");
  assert.ok(a.descriptor.source, "descriptor.source is null — the React 19 lookup failed");
  assert.strictEqual(a.descriptor.source.file, "src/app/login/page.tsx");
  assert.strictEqual(a.descriptor.source.via, "next-dev");
  assert.ok(a.descriptor.components.includes("LoginPage"), "components: " + a.descriptor.components);
});

check("a comment on a client input resolves into the app's code, not node_modules", async (page) => {
  const a = await comment(page, INPUT, "gate: client source");
  const src = a.descriptor.source;
  assert.ok(src, "descriptor.source is null");
  assert.match(src.file, /^src\//, "resolved to " + src.file);
  const lines = fs.readFileSync(path.join(APP, src.file), "utf8").split("\n").length;
  assert.ok(src.line >= 1 && src.line <= lines, "line " + src.line + " exists in " + src.file + " (" + lines + " lines)");
  console.log("     " + src.file + ":" + src.line + " used from " + src.usedFrom.map((u) => u.file + ":" + u.line).join(", ") + " · " + a.descriptor.components.join(" < "));
  // The email field is drawn by the shared <Input>, and placed by the login form.
  // The file that placed it has to be reachable, or "make this wider" edits every input.
  assert.ok([src].concat(src.usedFrom).some((f) => f.file === "src/components/auth/login-form.tsx"), "login-form.tsx is in the chain");
});

// ---- checks end ----

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  for (const f of FILES) await ctx.addInitScript({ path: path.join(OVERLAY, f) });
  // ---- boot extras ----
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.evaluate(() => window.__annotatorMods.index.setup());

  let failed = 0;
  for (const c of checks) {
    try { await c.fn(page, ctx); console.log("ok   " + c.name); }
    catch (e) { failed++; console.log("FAIL " + c.name + "\n     " + (e && e.message)); }
  }
  if (pageErrors.length) { failed++; console.log("FAIL page errors: " + pageErrors.join(" | ")); }
  else console.log("ok   zero page errors");
  await browser.close();
  console.log(failed ? failed + " FAILED" : "phase3 gate: ok");
  process.exitCode = failed ? 1 : 0;
})();
