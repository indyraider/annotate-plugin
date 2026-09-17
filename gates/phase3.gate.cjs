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

check("the screenshot is taken at click time, before the comment box exists", async (page) => {
  // A red square that disappears the instant the comment box appears. If it is
  // in the shot, the shot was taken before the box opened.
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;right:0;top:0;width:80px;height:80px;background:rgb(255,0,0);z-index:2147483646;pointer-events:none";
    document.body.appendChild(d);
    new MutationObserver((_, obs) => {
      if (document.querySelector(".__ann-ui textarea")) { d.remove(); obs.disconnect(); }
    }).observe(document.body, { childList: true });
  });
  const a = await comment(page, "main h1", "gate: shot");
  assert.strictEqual(a.hasShot, true, "hasShot");
  const px = await page.evaluate(async (id) => {
    const data = window.__annotatorImageTake(id + "-shot");
    if (!data) return null;
    const img = new Image(); img.src = data; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(img.width - 40, 40, 1, 1).data);
  }, a.id);
  assert.ok(px, "the shot is retrievable as <id>-shot");
  assert.ok(px[0] > 200 && px[1] < 60 && px[2] < 60, "the transient red square is in the shot, pixel " + px);
});

check("Alt+↑ in the comment box moves the comment to the parent element", async (page) => {
  const a = await comment(page, INPUT, "gate: walk", { beforeType: () => page.keyboard.press("Alt+ArrowUp") });
  const ok = await page.evaluate(({ sel, input }) => document.querySelector(sel) === document.querySelector(input).parentElement, { sel: a.selector, input: INPUT });
  assert.ok(ok, "saved selector is the input's parent: " + a.selector);
});

check("⌘/Ctrl+click gathers several elements into one comment", async (page) => {
  await setMode(page, "on");
  await page.click("main h1", { modifiers: ["ControlOrMeta"] });
  await page.click("main button", { modifiers: ["ControlOrMeta"] });
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll("[data-ann-pick]").length), 2, "two pick outlines on screen");
  const a = await comment(page, INPUT, "gate: multi");
  assert.strictEqual(a.others.length, 2, "others: " + JSON.stringify(a.others.map((o) => o.selector)));
  assert.ok(a.others.every((o) => o.selector && o.descriptor && "source" in o.descriptor), "each extra carries selector, descriptor and source");
  assert.ok(a.others.some((o) => o.descriptor.source && o.descriptor.source.file === "src/app/login/page.tsx"), "the h1 pick resolved its own source");
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll("[data-ann-pick]").length), 0, "outlines cleared after save");
});

check("a comment carries the page's recent console errors and failed requests", async (page) => {
  // /_next/static/* is outside the auth middleware, so this is a genuine 404.
  // Other unknown paths redirect to /login and come back 200.
  await page.evaluate(async () => {
    console.error("gate-boom");
    await fetch("/_next/static/gate-missing.js").catch(() => {});
  });
  const a = await comment(page, "main h1", "gate: context");
  assert.ok(a.context, "context present");
  assert.ok(a.context.errors.some((e) => /gate-boom/.test(e.message)), "console.error captured: " + JSON.stringify(a.context.errors));
  const req = a.context.failedRequests.find((r) => /gate-missing\.js/.test(r.url));
  assert.ok(req && req.status === 404, "404 captured with its status: " + JSON.stringify(a.context.failedRequests));
  assert.ok(!a.context.failedRequests.some((r) => /__nextjs_original-stack-frames/.test(r.url)), "the overlay's own source lookup is not reported as page traffic");
});

check("Measure records the load's LCP, once per recording", async (page) => {
  await setMode(page, "measure");
  await page.waitForTimeout(300);
  const lcp = (await page.evaluate(() => window.__annotatorPerfTake())).filter((e) => e.kind === "lcp");
  assert.strictEqual(lcp.length, 1, "exactly one lcp entry: " + JSON.stringify(lcp));
  assert.ok(lcp[0].ms > 0 && /\/login/.test(lcp[0].url) && lcp[0].element, JSON.stringify(lcp[0]));
});

check("a client navigation that hits the server carries ttfbMs", async (page) => {
  await setMode(page, "measure");
  await page.evaluate(() => window.__annotatorPerfTake());
  await page.evaluate(() => window.next.router.push("/login?gate=" + Date.now()));
  await page.waitForTimeout(2000);
  const navs = (await page.evaluate(() => window.__annotatorPerfTake())).filter((e) => e.kind === "nav");
  assert.ok(navs.length > 0, "a nav entry was recorded");
  const hit = navs.find((n) => !n.servedFromCache);
  if (!hit) { console.log("     NOTE every nav was cache-served; ttfbMs not exercised this run"); return; }
  assert.strictEqual(typeof hit.ttfbMs, "number", JSON.stringify(hit));
  assert.ok("serverTiming" in hit, "serverTiming field present (null: this app sends no header)");
  console.log("     " + hit.to.replace(/^https?:\/\/[^/]+/, "") + " rscMs " + hit.rscMs + " ttfbMs " + hit.ttfbMs);
});

// ---- checks end ----

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  for (const f of FILES) await ctx.addInitScript({ path: path.join(OVERLAY, f) });
  // Same binding, same arguments, as SKILL.md's boot snippet.
  await ctx.exposeBinding("__annotatorShoot", async ({ page }) => "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64"));
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
