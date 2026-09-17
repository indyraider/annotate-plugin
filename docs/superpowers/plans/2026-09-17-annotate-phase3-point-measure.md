# Annotate Phase 3 — Point and Measure upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish spec §8 Phase 3. Every Point comment carries its real source file, a click-time screenshot, the page's recent errors, and can cover several elements or a parent. Measure gains LCP, server think-time, and a labelled mark point.

**Architecture:** Pure logic goes into `overlay/core.js` and is unit-tested in Node (`overlay.test.cjs`). DOM behaviour goes into `overlay/point.js`, `overlay/measure.js`, `overlay/ui.js` and `overlay/index.js`, with source-shape guards in the same test file. Each task then proves itself end to end in a real Chromium through a new gate script, `gates/phase3.gate.cjs`, which Task 2 creates and every later task extends.

**Tech Stack:** ES5 browser JavaScript (the modules are injected into arbitrary pages), Node's `assert` for unit tests, Playwright for the browser gate. No new dependencies.

**Spec:** `/Users/mattjones/Documents/brandscout-enterprise/docs/superpowers/specs/2026-08-07-annotate-product-design.md` §6.1, §6.2, §8 (Phase 3). Read §6 before starting. Also read `docs/PHASE3-LEDGER.md` (Compare, the half of Phase 3 already built) and `docs/HANDOFF.md` §"How this codebase fails".

## Global Constraints

- `overlay/*.js` is ES5: `var`, `function`, no arrow functions, no `let`/`const`/`class`, no `async`/`await`. It is evaluated inside arbitrary host pages. (Test and gate files are Node and may use modern syntax.)
- `core.js` stays DOM-free. It is `require`d in Node with no browser globals.
- Every module keeps loading under `require()` in Node. Anything that touches `window` at load time is guarded by `typeof window !== "undefined"`.
- The module list and its order do not change. This plan adds **no** module files (the test suite checks `OWN_MODULE_FILES` against the directory and against SKILL.md).
- Never add `<input type="file">` anywhere.
- Point mode's guards stay `state.mode !== "on"`. Never `=== "off"`.
- Wrapped page APIs (`fetch`, `console.error`, `history.*`) always delegate and always re-throw. The app must see exactly what it would see unwrapped.
- Branch: `matt/annotate-phase3-point-measure`. Commit after each task.
- Run the unit tests with `node skills/annotate/overlay.test.cjs` from the repo root. Expected final line: `overlay.test: ok`.

## What was verified before this plan was written (2026-09-17)

These facts were measured in a directly-driven Chromium against the Tideswell dev server (`/Users/mattjones/Documents/brandscout-enterprise`, React 19.2.4, Next 16.3.0, Turbopack dev) on its public `/login` page. The design below depends on them. Do not re-litigate them; the gate re-proves them.

1. **`fiber._debugSource` does not exist in React 19.** Today's `describe()` returns `source: null` on every comment.
2. **Every fiber has `_debugOwner` and `_debugStack`.** `_debugOwner` is the component that rendered the element: a fiber for client components (`owner.type.name`), plain info for server components (`owner.name`). `_debugStack.stack` is a string whose **third line** is the compiled JSX call site:
   - server component: `    at LoginPage (about://React/Server/file:///Users/mattjones/Documents/brandscout-enterprise/.next/dev/server/chunks/ssr/%5Broot-of-the-server%5D__0bcc7cb._.js?10:120:497)`
   - client component: `    at InnerLayoutRouter (http://localhost:3000/_next/static/chunks/node_modules__pnpm_0w17uau._.js:1208:50)`
3. **Next's dev server maps compiled sites back to files** at `POST /__nextjs_original-stack-frames` with body `{ frames: [{ file, line1, column1, methodName, arguments }], isServer, isEdgeServer, isAppDirectory }`. It answers an array, one result per frame: `{ status: "fulfilled", value: { originalStackFrame: { file, line1, column1 } } }` or `{ status: "rejected", reason }`.
   - Server frames resolve as sent: `LoginPage` → `src/app/login/page.tsx:21`.
   - Client frames fail as sent (`Unknown url scheme 'http'`). Rewritten to `file://<distDir>/static/chunks/<name>` (percent-decoded), they all resolve: `LoginFormInner` → `src/components/auth/login-form.tsx:54`. `<distDir>` is the part of any server frame between `file://` and `/server/` (here `/Users/mattjones/Documents/brandscout-enterprise/.next/dev`).
   - Library components resolve into `node_modules/...`. The useful answer is the first frame, walking up from the element, whose file is not under `node_modules`.
4. **Playwright can take a screenshot on the page's request.** `context.exposeBinding("__annotatorShoot", async ({ page }) => ... page.screenshot({ type: "jpeg", quality: 70, scale: "css" }))` called from a page click handler returned a 45KB JPEG data URL in 28ms, and the binding survives navigation (it is registered on the context, like `addInitScript`).
5. **The app sends `Permissions-Policy: microphone=()`.** Microphone access is forbidden on every page of the app the Point mode exists for. This settles the spec's voice timebox; see Task 9.
6. **The app sends no `Server-Timing` header.** A `serverTiming` field will be `null` there. Time to first byte (`responseStart - requestStart`) is the server think-time that is always available for same-origin requests.
7. **The app's CSP is only `frame-ancestors 'none'`**, so the gate can decode a screenshot inside the page. `GET /_next/static/gate-missing.js` returns a real 404 (other unknown paths redirect to `/login` through auth middleware and return 200).

## File map

| File | Change |
|---|---|
| `skills/annotate/overlay/core.js` | + `parseDebugStack`, `nextDistDir`, `toNextFrameFile`, `firstAppFrame` (T1); + `createRecentLog` (T6); + `ttfbOf`, `serverTimingOf`, `lcp` key (T7); `mark` key (T8) |
| `skills/annotate/overlay/point.js` | source lookup + async save (T2); click-time shot (T3); tree walk (T4); multi-select (T5); context hooks (T6) |
| `skills/annotate/overlay/index.js` | `wake()` + "resolving" status (T2); hint text (T5); measure panel, Alt+M, `__annotatorMark` (T8) |
| `skills/annotate/overlay/measure.js` | LCP, ttfbMs, serverTiming (T7); `mark()` (T8) |
| `skills/annotate/overlay/ui.js` | `measurePanel`, `setModeTools` same-node guard (T8) |
| `skills/annotate/overlay.test.cjs` | unit tests and guards, every task |
| `skills/annotate/SKILL.md` | boot snippet ×2 (T3); agent-facing docs (T9) |
| `gates/phase3.gate.cjs` | **new**, real-browser gate. Outside `skills/` so it never ships to consumers (T2, extended by T3–T8) |
| `docs/HANDOFF.md`, `docs/PHASE3-LEDGER.md` | T9 |

---

### Task 1: Pure helpers for React 19 source lookup

**Files:**
- Modify: `skills/annotate/overlay/core.js` (add before `firstFamily`, and to the export object at the bottom)
- Test: `skills/annotate/overlay.test.cjs` (add a new section just above the final `Promise.all([`)

**Interfaces:**
- Produces:
  - `core.parseDebugStack(stack: string) -> { file: string, line1: number, column1: number, methodName: string, arguments: [] } | null`
  - `core.nextDistDir(file: string) -> string | null`
  - `core.toNextFrameFile(file: string, distDir: string|null) -> string`
  - `core.firstAppFrame(results: Array|null) -> { file: string, line: number, column: number } | null`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mattjones/Documents/annotate-plugin
git checkout -b matt/annotate-phase3-point-measure
```

- [ ] **Step 2: Write the failing tests**

Add above the final `Promise.all([` in `skills/annotate/overlay.test.cjs`:

```js
// ---- Phase 3: element -> source on React 19 --------------------------------
// React 19 removed fiber._debugSource. These stacks are the real shapes read off
// fibers on the Tideswell /login page (React 19.2.4, Next 16.3 Turbopack dev),
// 2026-09-17. Line 0 is React's marker, line 1 is React's own JSX helper, line 2
// is the component that wrote the JSX — the only line worth sending.
const SERVER_STACK = [
  "Error: react-stack-top-frame",
  "    at fakeJSXCallSite (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-server-dom-turbopack_14crl3y._.js:2002:21)",
  "    at LoginPage (about://React/Server/file:///Users/mattjones/Documents/brandscout-enterprise/.next/dev/server/chunks/ssr/%5Broot-of-the-server%5D__0bcc7cb._.js?10:120:497)",
  "    at Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-server-dom-turbopack_14crl3y._.js:2769:93)"
].join("\n");
const CLIENT_STACK = [
  "Error: react-stack-top-frame",
  "    at exports.jsx (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_1yan1u3._.js:1151:33)",
  "    at InnerLayoutRouter (http://localhost:3000/_next/static/chunks/node_modules__pnpm_0w17uau._.js:1208:50)",
  "    at Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/0l4__next_dist_compiled_react-dom_1pmu1hc._.js:14895:24)"
].join("\n");

assert.deepStrictEqual(core.parseDebugStack(SERVER_STACK), {
  file: "about://React/Server/file:///Users/mattjones/Documents/brandscout-enterprise/.next/dev/server/chunks/ssr/%5Broot-of-the-server%5D__0bcc7cb._.js?10",
  line1: 120, column1: 497, methodName: "LoginPage", arguments: []
}, "server component frame: the ?10 query stays on the file, line and column come off the end");
assert.deepStrictEqual(core.parseDebugStack(CLIENT_STACK), {
  file: "http://localhost:3000/_next/static/chunks/node_modules__pnpm_0w17uau._.js",
  line1: 1208, column1: 50, methodName: "InnerLayoutRouter", arguments: []
}, "client component frame");
assert.deepStrictEqual(core.parseDebugStack("Error\n    at x\n    at http://localhost:3000/a.js:3:4"),
  { file: "http://localhost:3000/a.js", line1: 3, column1: 4, methodName: "", arguments: [] },
  "an anonymous frame has no method name, not a wrong one");
assert.strictEqual(core.parseDebugStack("Error: only a header"), null, "too short -> null");
assert.strictEqual(core.parseDebugStack(undefined), null, "no stack -> null");

// The dist dir is only readable off a server frame. Client chunk URLs have to be
// rewritten into it, or the endpoint answers "Unknown url scheme 'http'".
const SERVER_FILE = core.parseDebugStack(SERVER_STACK).file;
assert.strictEqual(core.nextDistDir(SERVER_FILE), "/Users/mattjones/Documents/brandscout-enterprise/.next/dev");
assert.strictEqual(core.nextDistDir("http://localhost:3000/_next/static/chunks/a.js"), null, "a client URL carries no dist dir");
assert.strictEqual(core.nextDistDir(null), null);

assert.strictEqual(
  core.toNextFrameFile("http://localhost:3000/_next/static/chunks/1p46_%40base-ui_react._.js", "/app/.next/dev"),
  "file:///app/.next/dev/static/chunks/1p46_@base-ui_react._.js",
  "client chunk URL -> file in the dist dir, percent-decoded (measured: %40 must become @)");
assert.strictEqual(core.toNextFrameFile(SERVER_FILE, "/app/.next/dev"), SERVER_FILE, "server frames are sent as they are");
assert.strictEqual(core.toNextFrameFile("http://localhost:3000/_next/static/chunks/a.js", null),
  "http://localhost:3000/_next/static/chunks/a.js", "no dist dir -> unchanged");

// The element's own frame is usually library code (a design-system <Button>).
// The answer is the nearest frame in the app's code.
const RESOLVED = [
  { status: "rejected", reason: "Unknown url scheme 'http'" },
  { status: "fulfilled", value: { originalStackFrame: { file: "node_modules/.pnpm/@base-ui+react@1.5.0/node_modules/@base-ui/react/esm/internals/useRenderElement.js", line1: 168, column1: 3 } } },
  { status: "fulfilled", value: { originalStackFrame: null } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/components/auth/login-form.tsx", line1: 64, column1: 9 } } },
  { status: "fulfilled", value: { originalStackFrame: { file: "src/app/login/page.tsx", line1: 21, column1: 5 } } }
];
assert.deepStrictEqual(core.firstAppFrame(RESOLVED), { file: "src/components/auth/login-form.tsx", line: 64, column: 9 },
  "skips rejected, empty and node_modules frames; nearest app frame wins");
assert.strictEqual(core.firstAppFrame(RESOLVED.slice(0, 3)), null, "only library frames -> null, not a node_modules path");
assert.strictEqual(core.firstAppFrame(null), null, "endpoint returned nothing -> null");
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `TypeError: core.parseDebugStack is not a function`

- [ ] **Step 4: Implement**

In `skills/annotate/overlay/core.js`, add directly above `function firstFamily(value) {`:

```js
  // ---- Phase 3: element -> source on React 19 ----
  //
  // React 19 removed fiber._debugSource, so Point's source lookup returned null
  // on every comment. What React 19 keeps is fiber._debugStack, an Error whose
  // third line is the compiled JSX call site. Next's dev server maps a compiled
  // site back to a file through the endpoint its own error overlay uses. These
  // four helpers are the pure half of that; point.js does the fetching.

  // Pure: the JSX call site off a _debugStack string, in the frame shape Next's
  // endpoint takes. Line 2, because 0 is React's marker and 1 is React's own
  // JSX helper.
  function parseDebugStack(stack) {
    var line = String(stack || "").split("\n")[2];
    if (!line) return null;
    var m = /^at (?:(\S+) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m) return null;
    return { file: m[2], line1: Number(m[3]), column1: Number(m[4]), methodName: m[1] || "", arguments: [] };
  }

  // Pure: Next's build directory, read off a server component's frame. Nothing
  // else on the page says where it is, and client frames need it (below).
  function nextDistDir(file) {
    var m = /^about:\/\/React\/Server\/file:\/\/(\/.+?)\/server\//.exec(String(file || ""));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Pure: a client chunk URL rewritten into the dist dir, the way Next's own
  // parseStack does it server-side. Sent as an http URL the endpoint answers
  // "Unknown url scheme 'http'". Percent-decoded: measured, %40 fails and @ works.
  function toNextFrameFile(file, distDir) {
    var s = String(file || "");
    var m = /^https?:\/\/[^/]+\/_next(\/static\/[^?#]+)/.exec(s);
    if (!m || !distDir) return s;
    return "file://" + distDir + decodeURIComponent(m[1]);
  }

  // Pure: the nearest frame in the app's own code. Results arrive in walk order
  // (the element first, then its ancestors), and the element itself is usually
  // a library component whose file is useless to the person fixing the page.
  function firstAppFrame(results) {
    var list = results || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var f = r && r.status === "fulfilled" && r.value && r.value.originalStackFrame;
      if (f && f.file && !/(^|\/)node_modules\//.test(f.file)) return { file: f.file, line: f.line1, column: f.column1 };
    }
    return null;
  }
```

And extend the export object's last line from:

```js
    summariseRun: summariseRun, compareRuns: compareRuns,
```

to:

```js
    summariseRun: summariseRun, compareRuns: compareRuns,
    parseDebugStack: parseDebugStack, nextDistDir: nextDistDir,
    toNextFrameFile: toNextFrameFile, firstAppFrame: firstAppFrame,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 6: Sabotage check**

Change `split("\n")[2]` to `split("\n")[1]` in `parseDebugStack`, run the tests, confirm the server-frame assertion fails, then restore. A test that stays green against this change is decorative.

- [ ] **Step 7: Commit**

```bash
git add skills/annotate/overlay/core.js skills/annotate/overlay.test.cjs
git commit -m "feat(annotate): pure helpers that turn a React 19 fiber stack into a source file"
```

---

### Task 2: Every comment carries its source file and component names

**Files:**
- Modify: `skills/annotate/overlay/point.js`
- Modify: `skills/annotate/overlay/index.js`
- Test: `skills/annotate/overlay.test.cjs`
- Create: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `core.parseDebugStack`, `core.nextDistDir`, `core.toNextFrameFile`, `core.firstAppFrame` (Task 1)
- Produces:
  - `ctx.wake()`: wakes a pending long-poll, but only if an annotation with `status: "new"` exists.
  - Annotation `status` gains the value `"resolving"`: saved and badged but not yet handed to the agent. `__annotatorDrain` only returns `"new"`, so it never sees these.
  - `descriptor.components: string[]`: owner component names, nearest first, at most 5.
  - `descriptor.source: { file, line, column, via: "next-dev" | "react-debug-source" } | null`
  - `window.__annotatorRawFetch`: the page's `fetch` as it was at module load, before any wrapping.
  - In point.js: `resolveSource(el) -> Promise<source|null>` (never rejects, settles within 1500ms), and `record(el, comment, image)` (Task 3 adds a 4th argument, Task 5 changes the first to an array).
  - Gate harness: `check(name, async fn)`, `setMode(page, key)`, `comment(page, selector, text, opts?) -> annotation`, the `APP` path constant.

- [ ] **Step 1: Write the failing guards**

Add below the Task 1 section in `overlay.test.cjs`:

```js
// ---- Phase 3: point.js uses the lookup, and never hands over a half-built comment ----
// The DOM half is proven in gates/phase3.gate.cjs against a real React 19 app;
// these guards catch the wiring being removed.
{
  const src = fs.readFileSync(MOD("point.js"), "utf8");
  const idx = fs.readFileSync(MOD("index.js"), "utf8");
  assert.ok(/__nextjs_original-stack-frames/.test(codeOf(src)), "point.js resolves source through Next's dev endpoint");
  assert.ok(/core\.firstAppFrame\(/.test(codeOf(src)), "point.js picks the app's own frame, not a node_modules one");
  assert.ok(/__annotatorRawFetch\.call\(/.test(codeOf(src)), "the lookup uses the unwrapped fetch, so it is never recorded as page traffic");
  assert.ok(/status: "resolving"/.test(codeOf(src)), "a comment is saved as resolving before its source lookup settles");
  assert.ok(/a\.status === "resolving"/.test(codeOf(idx)), "index.js hands over a comment still resolving when the page reloaded");
  assert.ok(/function wake\(\)/.test(codeOf(idx)) && /wake: wake/.test(codeOf(idx)), "index.js gives modes a wake() that is separate from save()");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `point.js resolves source through Next's dev endpoint`

- [ ] **Step 3: index.js — wake(), and the resolving status**

In `skills/annotate/overlay/index.js`, replace:

```js
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
```

with:

```js
    var load = function () {
      try {
        // A comment still "resolving" when the page reloaded lost its source
        // lookup, not its text. Hand it over without a source rather than never.
        return (JSON.parse(localStorage.getItem(KEY)) || []).map(function (a) {
          if (a && a.status === "resolving") a.status = "new";
          return a;
        });
      } catch (e) { return []; }
    };
```

Replace:

```js
    function save(record) {
      window.__annotations.push(record);
      if (waiter) { var w = waiter; waiter = null; clearTimeout(w.timer); w.resolve(); }  // wake the long-poll
    }
```

with:

```js
    function save(record) {
      window.__annotations.push(record);
      wake();
    }
    // Wakes the long-poll only when there is something to hand over. Point saves
    // a comment as "resolving" first; waking on that would return the poll empty
    // and count as a quiet round in the watch loop.
    function wake() {
      if (!waiter) return;
      if (!window.__annotations.some(function (a) { return a.status === "new"; })) return;
      var w = waiter; waiter = null; clearTimeout(w.timer); w.resolve();
    }
```

Replace:

```js
    var ctx = { pal: pal, ui: uiHandles, state: state, save: save, persist: persist, notify: notify };
```

with:

```js
    var ctx = { pal: pal, ui: uiHandles, state: state, save: save, wake: wake, persist: persist, notify: notify };
```

- [ ] **Step 4: point.js — keep the unwrapped fetch**

In `skills/annotate/overlay/point.js`, directly below `var SANS = palette.SANS;`, add:

```js

  // The page's own fetch, captured at LOAD, before measure.js or the context
  // hooks wrap it. The overlay's lookups go through this, so they never show up
  // as the page's traffic. On window so a second copy of this module keeps the
  // first, unwrapped one.
  if (typeof window !== "undefined" && !window.__annotatorRawFetch) window.__annotatorRawFetch = window.fetch;
```

- [ ] **Step 5: point.js — the lookup**

Replace:

```js
    var pal = ctx.pal, ui = ctx.ui, state = ctx.state, save = ctx.save, persist = ctx.persist, notify = ctx.notify;
```

with:

```js
    var pal = ctx.pal, ui = ctx.ui, state = ctx.state, save = ctx.save, wake = ctx.wake, persist = ctx.persist, notify = ctx.notify;
```

Replace the whole `describe` function (from `function describe(el) {` through its closing `}`) with:

```js
    // ---- element -> source (React 19) ----
    // React 19 dropped fiber._debugSource, so this used to return null on every
    // comment and the agent fell back to grepping page text. Measured 2026-09-17
    // on React 19.2.4 / Next 16.3 Turbopack dev: every fiber still carries
    // _debugOwner (the component that rendered it) and _debugStack (whose third
    // line is the compiled JSX call site). Next's dev server maps a compiled site
    // back to a file through the endpoint its own error overlay uses.
    var SOURCE_WAIT_MS = 1500;
    var FIBER_WALK = 25;
    function fiberOf(el) {
      var k = Object.keys(el).find(function (x) { return x.indexOf("__reactFiber$") === 0 || x.indexOf("__reactInternalInstance$") === 0; });
      return k ? el[k] : null;
    }
    // A client owner is a fiber with the name on its type; a server owner is
    // plain component info carrying its own name.
    function ownerName(o) {
      if (!o) return null;
      if (o.type && typeof o.type !== "string") return o.type.displayName || o.type.name || null;
      return typeof o.name === "string" ? o.name : null;
    }
    // Nearest first, e.g. ["LoginFormInner", "LoginForm", "LoginPage"]. Works on
    // any React 19 dev build, Next or not, and a component name greps straight to
    // its definition when the file lookup comes back empty.
    function components(el) {
      var out = [];
      try {
        var f = fiberOf(el);
        for (var i = 0; f && i < FIBER_WALK && out.length < 5; i++, f = f.return) {
          var n = ownerName(f._debugOwner);
          if (n && out.indexOf(n) === -1) out.push(n);
        }
      } catch (e) {}
      return out;
    }
    // Next's build directory, read off the root layout's server frame. Memoised
    // once found; it cannot change while the page lives.
    var distDirMemo = null;
    function distDir() {
      if (distDirMemo) return distDirMemo;
      try {
        var f = fiberOf(document.documentElement);
        for (var i = 0; f && i < FIBER_WALK; i++, f = f.return) {
          var fr = f._debugStack && core.parseDebugStack(f._debugStack.stack);
          var d = fr && core.nextDistDir(fr.file);
          if (d) return (distDirMemo = d);
        }
      } catch (e) {}
      return null;
    }
    // Resolves { file, line, column, via } or null. Never rejects, never waits
    // longer than SOURCE_WAIT_MS. React <= 18's _debugSource first, then Next's
    // dev endpoint. No dist dir means this is not a Next App Router dev page, and
    // nothing is POSTed to a server that has no such endpoint.
    // ponytail: Next App Router dev only; Vite or the Pages Router get component
    // names and a grep. Add a source-map reader if those become real users.
    function resolveSource(el) {
      var frames = [];
      try {
        var f = fiberOf(el);
        for (var i = 0; f && i < FIBER_WALK; i++, f = f.return) {
          var s = f._debugSource;
          if (s) return Promise.resolve({ file: s.fileName, line: s.lineNumber, column: s.columnNumber || null, via: "react-debug-source" });
          var fr = f._debugStack && core.parseDebugStack(f._debugStack.stack);
          if (fr) frames.push(fr);
        }
      } catch (e) {}
      var dist = distDir();
      if (!frames.length || !dist || !window.__annotatorRawFetch) return Promise.resolve(null);
      frames.forEach(function (fr) { fr.file = core.toNextFrameFile(fr.file, dist); });
      var lookup = window.__annotatorRawFetch.call(window, "/__nextjs_original-stack-frames", {
        method: "POST",
        body: JSON.stringify({ frames: frames, isServer: false, isEdgeServer: false, isAppDirectory: true })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { var hit = core.firstAppFrame(data); if (hit) hit.via = "next-dev"; return hit; })
        .catch(function () { return null; });
      var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, SOURCE_WAIT_MS); });
      return Promise.race([lookup, giveUp]);
    }

    function describe(el) {
      var attrs = {};
      var list = el.attributes || [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i].name;
        if (n.indexOf("data-") === 0 || n === "aria-label" || n === "role" || n === "name") attrs[n] = list[i].value;
      }
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : "",
        id: el.id || null,
        className: (typeof el.className === "string" ? el.className : "") || null,
        text: (el.textContent || "").trim().slice(0, 120) || null,
        attrs: attrs,
        components: components(el),
        source: null                       // record() fills this in once resolveSource settles
      };
    }
```

- [ ] **Step 6: point.js — save now, hand over when the source is in**

Replace the whole `record` function with:

```js
    function record(el, comment, image) {
      seq += 1;
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el), comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "resolving", hasImage: !!image };
      // The image never rides along in the annotation — the agent pulls it by id.
      if (image) putImage(a.id, image);
      // Saved, persisted and badged NOW, so a navigation in the next second
      // cannot lose the comment. Handed to the agent only once the lookup
      // settles, so the agent never reads a source that is still on its way.
      save(a); persist(); addBadge(el, seq); notify();
      resolveSource(el).then(function (src) {
        a.descriptor.source = src;
        a.status = "new";
        persist(); wake(); notify();
      });
    }
```

- [ ] **Step 7: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 8: Create the gate with its first check**

Create `gates/phase3.gate.cjs`:

```js
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
  console.log("     " + src.file + ":" + src.line + " · " + a.descriptor.components.join(" < "));
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
```

- [ ] **Step 9: Run the gate**

Run (repo root, dev server up):
```bash
PLAYWRIGHT=/Users/mattjones/Documents/brandscout-enterprise/node_modules/.pnpm/@playwright+test@1.60.0/node_modules/playwright node gates/phase3.gate.cjs
```
Expected: both checks `ok`, `ok   zero page errors`, `phase3 gate: ok`. The client check prints the resolved file and line; open that line and confirm it is where the email input is written.

If `localhost:3000` is not running, stop and ask Matt. Never start or kill his dev server.

- [ ] **Step 10: Sabotage check**

In point.js, temporarily change `core.toNextFrameFile(fr.file, dist)` to `fr.file`. Re-run the gate: the client check must FAIL and the server check must still pass (server frames need no rewrite). Restore.

- [ ] **Step 11: Commit**

```bash
git add skills/annotate/overlay/point.js skills/annotate/overlay/index.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): comments carry their real source file again on React 19"
```

---

### Task 3: The screenshot is taken at click time

**Files:**
- Modify: `skills/annotate/overlay/point.js`
- Modify: `skills/annotate/SKILL.md` (both boot snippets)
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `putImage(id, dataUrl)` and `takeImage(id)`, both already in point.js; `record(el, comment, image)` from Task 2.
- Produces:
  - `window.__annotatorShoot() -> Promise<string>`, registered by the boot snippet (Playwright `exposeBinding`). May be absent; everything degrades to `hasShot: false`.
  - Annotation field `hasShot: boolean`. The shot is stored under image id `<annotation id>-shot` and read with `__annotatorImageTake("<id>-shot")`.
  - `record(el, comment, image, shot)`: the 4th argument is a data URL or null.
  - `openComment(el, x, y, shot)`

- [ ] **Step 1: Write the failing guards**

Add to `overlay.test.cjs` below the Task 2 block:

```js
// ---- Phase 3: click-time screenshot ----
// Taken when Matt clicks, not when the agent gets round to it: by then a tooltip
// or an open dropdown is gone, which made those states impossible to annotate.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
  assert.ok(/shoot\(\)\.then\(function \(shot\) \{[\s\S]{0,300}openComment\(el, x, y, shot\)/.test(src),
    "the comment box opens only AFTER the screenshot resolves — opened first, the box covers what was clicked");
  assert.ok(/putImage\(a\.id \+ "-shot", shot\)/.test(src), "the shot is stored under <id>-shot, never inside the annotation");
  assert.strictEqual((skill.match(/exposeBinding\("__annotatorShoot"/g) || []).length, 2,
    "both boot snippets in SKILL.md register the screenshot binding");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `the comment box opens only AFTER the screenshot resolves`

- [ ] **Step 3: Implement in point.js**

Replace:

```js
    var box = null, target = null, pendingImage = null;
    function openComment(el, x, y) {
      closeComment(); target = el;
```

with:

```js
    var box = null, target = null, pendingImage = null, pendingShot = null;
    function openComment(el, x, y, shot) {
      closeComment(); target = el; pendingShot = shot || null;
```

In `openComment`, replace:

```js
      var submit = function () { var v = ta.value.trim(); if (v) record(target, v, pendingImage); closeComment(); };
```

with:

```js
      var submit = function () { var v = ta.value.trim(); if (v) record(target, v, pendingImage, pendingShot); closeComment(); };
```

Replace:

```js
    function closeComment() { if (box) { box.remove(); box = null; target = null; pendingImage = null; } }
```

with:

```js
    function closeComment() { if (box) { box.remove(); box = null; target = null; pendingImage = null; } pendingShot = null; }
```

In `record`, change the signature and body. Replace:

```js
    function record(el, comment, image) {
      seq += 1;
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el), comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "resolving", hasImage: !!image };
      // The image never rides along in the annotation — the agent pulls it by id.
      if (image) putImage(a.id, image);
```

with:

```js
    function record(el, comment, image, shot) {
      seq += 1;
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el), comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "resolving", hasImage: !!image, hasShot: !!shot };
      // Neither image rides along in the annotation — the agent pulls each by id.
      if (image) putImage(a.id, image);
      if (shot) putImage(a.id + "-shot", shot);
```

Replace the `onClick` function with:

```js
    // The screenshot binding the boot snippet registers (Playwright's
    // exposeBinding). Absent on the fallback boot path, and then comments simply
    // carry no shot and the agent screenshots at processing time as before.
    var SHOT_WAIT_MS = 1500;
    function shoot() {
      if (typeof window.__annotatorShoot !== "function") return Promise.resolve(null);
      var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, SHOT_WAIT_MS); });
      var shot = window.__annotatorShoot().then(null, function () { return null; });
      return Promise.race([shot, giveUp]);
    }
    function onClick(e) {
      if (state.mode !== "on") return;
      if (e.shiftKey) return;                        // peek: let the app handle this click
      if (ui.isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      var el = e.target, x = e.clientX, y = e.clientY;
      // Shot first, box second. The tooltip or open menu Matt is pointing at is on
      // screen NOW; the box would cover it, and processing time is far too late.
      // The highlight ring stays in the shot on purpose: it marks what was clicked.
      closeComment(); ui.hideInspector();
      shoot().then(function (shot) {
        if (state.mode !== "on") return;             // left the mode while the shot was taken
        openComment(el, x, y, shot);
      });
    }
```

- [ ] **Step 4: Register the binding in both SKILL.md boot snippets**

`SKILL.md` has the boot snippet twice (Setup step 3, and the "escape hatch" under Study's honest limits). In **both**, directly below the line

```
     try { await page.context().grantPermissions(["local-fonts"]); } catch (e) {}
```

(indented to match its snippet), add:

```
     try { await page.context().exposeBinding("__annotatorShoot", async ({ page }) => "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64")); } catch (e) {}
```

It is wrapped in try/catch because `exposeBinding` throws when the same name is registered twice on one context, which happens whenever the boot is re-run. The first registration stays live.

- [ ] **Step 5: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 6: Extend the gate**

In `gates/phase3.gate.cjs`, replace the line `  // ---- boot extras ----` with:

```js
  // Same binding, same arguments, as SKILL.md's boot snippet.
  await ctx.exposeBinding("__annotatorShoot", async ({ page }) => "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64"));
  // ---- boot extras ----
```

Add above `// ---- checks end ----`:

```js
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
```

- [ ] **Step 7: Run the gate**

Run the gate command from Task 2 Step 9.
Expected: all checks `ok`, `phase3 gate: ok`.

- [ ] **Step 8: Sabotage check**

In `onClick`, temporarily open the box before the shot (`openComment(el, x, y, null); shoot().then(function (shot) { pendingShot = shot; });`). The gate's red-pixel check must FAIL. Restore.

- [ ] **Step 9: Commit**

```bash
git add skills/annotate/overlay/point.js skills/annotate/SKILL.md skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): screenshot at click time, so tooltips and open menus can be annotated"
```

---

### Task 4: Walk up the tree from the comment box

**Files:**
- Modify: `skills/annotate/overlay/point.js`
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `ui.showHighlight(el)`, `btn(label, primary)` (both existing); `openComment(el, x, y, shot)` from Task 3.
- Produces: inside `openComment`, `walkUp()`, `walkDown()` and `paintWhere()`, closing over the module-level `target`. Task 5 edits `paintWhere`.

- [ ] **Step 1: Write the failing guards**

```js
// ---- Phase 3: tree walk ----
// The click lands on a <span>; the comment is about the card. ↑ in the box moves
// the target to the parent. The highlight follows the TARGET while the box is
// open, not the mouse, or the ring stops showing what the comment is about.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  assert.ok(/e\.altKey && e\.key === "ArrowUp"/.test(src) && /e\.altKey && e\.key === "ArrowDown"/.test(src), "Alt+↑/↓ walk the target from the comment box");
  assert.ok(/if \(box\) \{ ui\.hideInspector\(\); return; \}/.test(src), "while the box is open, mousemove no longer moves the highlight off the target");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `Alt+↑/↓ walk the target from the comment box`

- [ ] **Step 3: Implement**

In `openComment`, directly after the `Object.assign(box.style, {...});` line, add:

```js
      // ---- walk the tree: the click landed on a <span>, the comment is about the card ----
      var trail = [];                                // elements walked up from, nearest last
      var walk = document.createElement("div");
      Object.assign(walk.style, { display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px" });
      var where = document.createElement("span");
      Object.assign(where.style, { flex: "1", minWidth: "0", font: "11px " + SANS, color: pal.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
      var upBtn = btn("↑", false), downBtn = btn("↓", false);
      upBtn.title = "Parent element (Alt+↑)"; downBtn.title = "Back down (Alt+↓)";
      upBtn.style.padding = "2px 7px"; downBtn.style.padding = "2px 7px";
      function parentOf(n) { var p = n.parentElement; return p && p !== document.documentElement ? p : null; }
      function paintWhere() {
        var cls = (typeof target.className === "string" && target.className.trim()) ? "." + target.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        where.textContent = target.tagName.toLowerCase() + cls;
        upBtn.disabled = !parentOf(target); downBtn.disabled = !trail.length;
        ui.showHighlight(target);
      }
      function walkUp() { var p = parentOf(target); if (!p) return; trail.push(target); target = p; paintWhere(); }
      function walkDown() { if (!trail.length) return; target = trail.pop(); paintWhere(); }
      upBtn.onclick = walkUp; downBtn.onclick = walkDown;
      walk.append(where, upBtn, downBtn);
```

Replace:

```js
      ta.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } });
```

with:

```js
      ta.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); walkUp(); }
        else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); walkDown(); }
      });
```

Replace:

```js
      box.append(ta, thumbWrap, row); document.body.appendChild(box); ta.focus();
```

with:

```js
      box.append(walk, ta, thumbWrap, row); document.body.appendChild(box); paintWhere(); ta.focus();
```

In the same function's `Object.assign(box.style, ...)`, change `top: Math.min(y, window.innerHeight - 150) + "px"` to `top: Math.min(y, window.innerHeight - 180) + "px"`. The box is one row taller now.

In `onMousemove`, replace:

```js
      if (box) { ui.showHighlight(e.target); ui.hideInspector(); return; }  // keep tracking, don't cover the open comment box
```

with:

```js
      // While the box is open the ring marks what the comment is ABOUT, which the
      // tree walk can move. Following the mouse would point it at the wrong thing.
      if (box) { ui.hideInspector(); return; }
```

- [ ] **Step 4: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 5: Extend the gate**

Add above `// ---- checks end ----`:

```js
check("Alt+↑ in the comment box moves the comment to the parent element", async (page) => {
  const a = await comment(page, INPUT, "gate: walk", { beforeType: () => page.keyboard.press("Alt+ArrowUp") });
  const ok = await page.evaluate(({ sel, input }) => document.querySelector(sel) === document.querySelector(input).parentElement, { sel: a.selector, input: INPUT });
  assert.ok(ok, "saved selector is the input's parent: " + a.selector);
});
```

- [ ] **Step 6: Run the gate**

Expected: all checks `ok`, `phase3 gate: ok`.

- [ ] **Step 7: Commit**

```bash
git add skills/annotate/overlay/point.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): walk from the clicked element up to its parent before commenting"
```

---

### Task 5: ⌘/Ctrl+click gathers several elements into one comment

**Files:**
- Modify: `skills/annotate/overlay/point.js`
- Modify: `skills/annotate/overlay/index.js` (one hint string)
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `record(el, comment, image, shot)` (Task 3), `resolveSource(el)` (Task 2), `paintWhere()` (Task 4).
- Produces:
  - `record(els: Element[], comment, image, shot)`: the first element is primary.
  - Annotation field `others: [{ selector, descriptor }]`. Each `descriptor` has `components` and `source`, like the primary one.
  - Pick outlines are `.__ann-ui` divs with a `data-ann-pick` attribute.

**Decision recorded:** the spec says shift-click. Shift is already Point's "peek" (click through to the app for one action), which SKILL.md documents and Matt uses. ⌘ (Mac) / Ctrl (elsewhere) is used instead so peek keeps working. Say this to Matt when reporting the task.

- [ ] **Step 1: Write the failing guards**

```js
// ---- Phase 3: multi-select ----
// ⌘/Ctrl, not Shift: Shift is Point's peek, and taking it would break click-through.
{
  const src = codeOf(fs.readFileSync(MOD("point.js"), "utf8"));
  assert.ok(/if \(e\.metaKey \|\| e\.ctrlKey\) \{ togglePick\(el\); return; \}/.test(src), "⌘/Ctrl+click toggles a pick instead of opening the box");
  assert.ok(/if \(e\.shiftKey\) return;\s+\/\/ peek/.test(src), "Shift still means peek");
  assert.ok(/others: els\.slice\(1\)/.test(src), "extra elements ride along as others[]");
  assert.ok(/function disable\(\)[\s\S]*?clearPicks\(\)/.test(src), "leaving Point clears the pick outlines");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `⌘/Ctrl+click toggles a pick instead of opening the box`

- [ ] **Step 3: Implement**

In point.js, directly above `var box = null, target = null, pendingImage = null, pendingShot = null;`, add:

```js
    // ---- multi-select: ⌘/Ctrl+click gathers elements into the next comment ----
    // Not Shift, which the spec first named: Shift is already "peek", the
    // click-through Point users rely on, and taking it would break that.
    var picks = [];                                  // [{ el, mark }]
    function togglePick(el) {
      for (var i = 0; i < picks.length; i++) {
        if (picks[i].el === el) { picks[i].mark.remove(); picks.splice(i, 1); return; }
      }
      var r = el.getBoundingClientRect();
      var mark = document.createElement("div"); mark.className = "__ann-ui"; mark.setAttribute("data-ann-pick", "");
      Object.assign(mark.style, { position: "absolute", left: (r.left + window.scrollX - 3) + "px", top: (r.top + window.scrollY - 3) + "px", width: (r.width + 6) + "px", height: (r.height + 6) + "px", border: "2px dashed " + pal.accent, borderRadius: "5px", boxSizing: "border-box", pointerEvents: "none", zIndex: Z - 1 });
      document.body.appendChild(mark);
      picks.push({ el: el, mark: mark });
    }
    function clearPicks() { picks.forEach(function (p) { p.mark.remove(); }); picks = []; }
```

In `paintWhere` (Task 4), replace:

```js
        where.textContent = target.tagName.toLowerCase() + cls;
```

with:

```js
        where.textContent = target.tagName.toLowerCase() + cls + (picks.length ? "  + " + picks.length + " more" : "");
```

Replace the `submit` line and the cancel wiring:

```js
      var submit = function () { var v = ta.value.trim(); if (v) record(target, v, pendingImage, pendingShot); closeComment(); };
      cancel.onclick = closeComment; saveBtn.onclick = submit;
```

with:

```js
      var submit = function () {
        var v = ta.value.trim();
        var els = [target].concat(picks.map(function (p) { return p.el; }).filter(function (x) { return x !== target; }));
        if (v) record(els, v, pendingImage, pendingShot);
        clearPicks(); closeComment();
      };
      cancel.onclick = function () { clearPicks(); closeComment(); }; saveBtn.onclick = submit;
```

Replace the whole `record` function with:

```js
    function record(els, comment, image, shot) {
      seq += 1;
      var el = els[0];
      var a = { id: "a" + seq, n: seq, selector: buildSelector(el), descriptor: describe(el),
        others: els.slice(1).map(function (o) { return { selector: buildSelector(o), descriptor: describe(o) }; }),
        comment: comment, url: location.pathname + location.search, ts: new Date().toISOString(), status: "resolving", hasImage: !!image, hasShot: !!shot };
      // Neither image rides along in the annotation — the agent pulls each by id.
      if (image) putImage(a.id, image);
      if (shot) putImage(a.id + "-shot", shot);
      // Saved, persisted and badged NOW, so a navigation in the next second
      // cannot lose the comment. Handed to the agent only once every lookup
      // settles, so the agent never reads a source that is still on its way.
      save(a); persist(); els.forEach(function (x) { addBadge(x, seq); }); notify();
      Promise.all(els.map(resolveSource)).then(function (srcs) {
        a.descriptor.source = srcs[0];
        a.others.forEach(function (o, i) { o.descriptor.source = srcs[i + 1]; });
        a.status = "new";
        persist(); wake(); notify();
      });
    }
```

In `onClick`, replace:

```js
      var el = e.target, x = e.clientX, y = e.clientY;
```

with:

```js
      var el = e.target, x = e.clientX, y = e.clientY;
      if (e.metaKey || e.ctrlKey) { togglePick(el); return; }
```

Replace:

```js
    function onKeydown(e) { if (e.key === "Escape" && box) closeComment(); }
```

with:

```js
    // First Escape closes the box, the next one drops the picks.
    function onKeydown(e) {
      if (e.key !== "Escape") return;
      if (box) closeComment(); else if (picks.length) clearPicks();
    }
```

In `disable()`, replace:

```js
      ui.hideHighlight(); ui.hideInspector(); closeComment();
```

with:

```js
      ui.hideHighlight(); ui.hideInspector(); closeComment(); clearPicks();
```

In `index.js`, replace:

```js
        uiHandles.setModeTools(uiHandles.toolsText("Click an element to comment · hold Shift to click through"));
```

with:

```js
        uiHandles.setModeTools(uiHandles.toolsText("Click an element to comment · ⌘/Ctrl+click to gather several · hold Shift to click through"));
```

- [ ] **Step 4: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 5: Extend the gate**

Add above `// ---- checks end ----`:

```js
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
```

- [ ] **Step 6: Run the gate**

Expected: all checks `ok`, `phase3 gate: ok`.

- [ ] **Step 7: Commit**

```bash
git add skills/annotate/overlay/point.js skills/annotate/overlay/index.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): gather several elements into one comment with cmd-click"
```

---

### Task 6: Every comment carries the page's recent errors and failed requests

**Files:**
- Modify: `skills/annotate/overlay/core.js`
- Modify: `skills/annotate/overlay/point.js`
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `window.__annotatorRawFetch` (Task 2); `record(els, ...)` (Task 5).
- Produces:
  - `core.createRecentLog(cap: number) -> { push(entry: {t:number,...}), since(t: number) -> entry[] }`. Entries come out as copies.
  - `window.__annotatorContext = { errors: RecentLog, requests: RecentLog }`, installed once per document at module load.
  - Error entry: `{ t, source: "console.error" | "uncaught" | "unhandledrejection", message }`
  - Request entry: `{ t, url, status: number|null, error: string|null }`
  - Annotation field `context: { windowMs: 30000, errors: [...], failedRequests: [...] } | null`

**Scope, stated honestly:** the spec says "the element's console errors". Errors cannot be attributed to an element. What ships is the page's errors and failed requests from the 30 seconds before the save, labelled as that.

- [ ] **Step 1: Write the failing tests**

Add below the Task 5 block:

```js
// ---- Phase 3: silent context ----
const rl = core.createRecentLog(3);
[1, 2, 3, 4].forEach((t) => rl.push({ t, n: t }));
assert.deepStrictEqual(rl.since(0).map((e) => e.n), [2, 3, 4], "caps at 3, oldest out first");
assert.deepStrictEqual(rl.since(3).map((e) => e.n), [3, 4], "since() is inclusive");
const rlCopy = rl.since(0); rlCopy[0].n = 99;
assert.strictEqual(rl.since(0)[0].n, 2, "since() hands out copies, so a saved comment's context cannot change afterwards");

// The hooks run at module LOAD in a real page. Prove them in a sandbox that has
// a window, and prove a second copy of the module adds no second hook.
const vm = require("node:vm");
const contextHookCheck = (function () {
  const seen = [];
  const sb = { console: { error: function () { seen.push([].slice.call(arguments)); } }, Error: Error, JSON: JSON, Date: Date, Promise: Promise, String: String, Array: Array, Object: Object, listeners: {} };
  sb.self = sb; sb.window = sb;
  sb.addEventListener = function (type, fn) { sb.listeners[type] = sb.listeners[type] || []; sb.listeners[type].push(fn); };
  sb.fetch = function (url) {
    if (url === "/boom") return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: url !== "/bad", status: url === "/bad" ? 404 : 200, type: "basic" });
  };
  const pageFetch = sb.fetch;
  vm.createContext(sb);
  for (const f of ["core.js", "palette.js", "point.js", "point.js"]) vm.runInContext(fs.readFileSync(MOD(f), "utf8"), sb, { filename: f });
  const log = sb.__annotatorContext;
  assert.ok(log, "point.js hooks the page at load when a window exists");
  assert.strictEqual(sb.__annotatorRawFetch, pageFetch, "the unwrapped fetch is kept for the overlay's own lookups");
  assert.strictEqual(sb.listeners.error.length, 1, "a second copy of point.js adds no second error hook");

  sb.console.error("boom", { code: 7 });
  assert.strictEqual(seen.length, 1, "console.error still reaches the page's console, exactly once");
  assert.match(log.errors.since(0)[0].message, /boom \{"code":7\}/);
  sb.listeners.error[0]({ target: { src: "http://x/a.png", tagName: "IMG" } });
  sb.listeners.error[0]({ target: sb, error: new Error("kaboom"), message: "kaboom" });
  sb.listeners.unhandledrejection[0]({ reason: "nope" });
  assert.deepStrictEqual(log.errors.since(0).map((e) => e.source), ["console.error", "uncaught", "unhandledrejection"]);

  return Promise.all([
    sb.fetch("/ok"),
    sb.fetch("/bad"),
    sb.fetch("/boom").then(function () { throw new Error("the rejection was swallowed"); }, function (e) { assert.strictEqual(e.message, "offline", "the app sees the rejection unchanged"); })
  ]).then(function (res) {
    assert.strictEqual(res[1].status, 404, "the app gets its own response object back");
    assert.deepStrictEqual(log.requests.since(0).map((r) => [r.url, r.status]),
      [["http://x/a.png", null], ["/bad", 404], ["/boom", null]], "failed image, 404 and network failure are logged; the 200 is not");
  });
})();
```

Then add `contextHookCheck,` as a new first element inside the final `Promise.all([` array, so a hook assertion that fails asynchronously turns the suite red:

```js
Promise.all([
  contextHookCheck,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `TypeError: core.createRecentLog is not a function`

- [ ] **Step 3: Implement `createRecentLog` in core.js**

Add directly above `function firstFamily(value) {`:

```js
  // Pure: a capped log a comment can ask "what happened in the last N seconds?".
  // since() hands out copies: a comment's saved context must not change later.
  function createRecentLog(cap) {
    var items = [];
    return {
      push: function (e) { items.push(e); if (items.length > cap) items.shift(); },
      since: function (t) {
        return items.filter(function (e) { return e.t >= t; }).map(function (e) {
          var c = {}; for (var k in e) c[k] = e[k]; return c;
        });
      }
    };
  }
```

Add `createRecentLog: createRecentLog,` to the export object.

- [ ] **Step 4: Implement the hooks in point.js**

Directly below the `window.__annotatorRawFetch` line from Task 2, add:

```js

  // ---- silent context: hooked at LOAD, not in create() ----
  // The error worth knowing about happened before the click that reported it,
  // and create() only runs when the agent calls setup(). addInitScript injects
  // this module ahead of the page's own scripts, so hooking here sees the app
  // from its first line. The logs live on window so a second copy of this module
  // adds no second set of hooks and reads the same history.
  // ponytail: fetch only; XMLHttpRequest failures are not captured. Add an XHR
  // hook if an app that still uses it shows up.
  if (typeof window !== "undefined" && !window.__annotatorContext) {
    var clip = function (v) { return String(v).slice(0, 300); };
    var text = function (v) {
      if (v instanceof Error) return v.stack || v.message;
      if (v && typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }
      return String(v);
    };
    var log = window.__annotatorContext = { errors: core.createRecentLog(20), requests: core.createRecentLog(20) };
    var pageConsoleError = console.error;
    console.error = function () {
      try { log.errors.push({ t: Date.now(), source: "console.error", message: clip(Array.prototype.map.call(arguments, text).join(" ")) }); } catch (e) {}
      return pageConsoleError.apply(this, arguments);
    };
    window.addEventListener("error", function (e) {
      var t = e.target;
      // A failed <img>/<script>/<link> fires a non-bubbling error that only a
      // capture listener on window sees. It carries the URL and no status.
      if (t && t !== window && (t.src || t.href)) log.requests.push({ t: Date.now(), url: clip(t.src || t.href), status: null, error: "<" + String(t.tagName).toLowerCase() + "> failed to load" });
      else log.errors.push({ t: Date.now(), source: "uncaught", message: clip((e.error && e.error.stack) || e.message) });
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      log.errors.push({ t: Date.now(), source: "unhandledrejection", message: clip(text(e.reason)) });
    });
    var pageFetch = window.fetch;
    if (pageFetch) window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || String(input);
      // Always delegates, always re-throws: the app sees exactly what it would unwrapped.
      return pageFetch.apply(this, arguments).then(function (res) {
        if (!res.ok && res.type !== "opaque") log.requests.push({ t: Date.now(), url: clip(url), status: res.status, error: null });
        return res;
      }, function (err) {
        log.requests.push({ t: Date.now(), url: clip(url), status: null, error: clip(text(err)) });
        throw err;
      });
    };
  }
```

Inside `create`, directly above `// seq lives here, not in index.js`, add:

```js
    // Page-wide, not per-element: an error cannot be traced to the element it
    // broke. What is honest is "this happened on the page in the 30s before".
    var CONTEXT_WINDOW_MS = 30000;
    function recentContext() {
      var log = window.__annotatorContext;
      if (!log) return null;
      var since = Date.now() - CONTEXT_WINDOW_MS;
      return { windowMs: CONTEXT_WINDOW_MS, errors: log.errors.since(since), failedRequests: log.requests.since(since) };
    }
```

In `record`, change `status: "resolving", hasImage: !!image, hasShot: !!shot };` to:

```js
status: "resolving", hasImage: !!image, hasShot: !!shot, context: recentContext() };
```

- [ ] **Step 5: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 6: Sabotage check**

Remove `throw err;` from the fetch hook's rejection handler. The unit test `the app sees the rejection unchanged` must FAIL. Restore.

- [ ] **Step 7: Extend the gate**

Add above `// ---- checks end ----`:

```js
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
```

- [ ] **Step 8: Run the gate**

Expected: all checks `ok`, `phase3 gate: ok`. Page errors must still be zero: `console.error` is not a page error, and the gate's fetch is caught.

- [ ] **Step 9: Commit**

```bash
git add skills/annotate/overlay/core.js skills/annotate/overlay/point.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): every comment carries the page's recent errors and failed requests"
```

---

### Task 7: Measure records LCP and server think-time

**Files:**
- Modify: `skills/annotate/overlay/core.js`
- Modify: `skills/annotate/overlay/measure.js`
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Produces:
  - `core.ttfbOf(entry: PerformanceResourceTiming-like) -> number | null`
  - `core.serverTimingOf(entry) -> [{ name, ms, desc }] | null`
  - `core.entryKey({ kind: "lcp", url })` returns `"lcp <normalised path>"`.
  - New perf entry `{ t, kind: "lcp", url, ms, size, element }`, at most one per recording, updated in place as later candidates arrive.
  - `nav` entries gain `ttfbMs: number|null` and `serverTiming: [...]|null`. `img` entries gain `serverTiming`.

- [ ] **Step 1: Write the failing tests**

```js
// ---- Phase 3: Measure — LCP and server think-time ----
// "Felt slow" vs "the server took 900ms". TTFB is always there same-origin;
// Server-Timing only when the app sends the header (Tideswell does not, 2026-09-17).
assert.strictEqual(core.ttfbOf({ requestStart: 100.2, responseStart: 340.9 }), 241);
assert.strictEqual(core.ttfbOf({ requestStart: 0, responseStart: 0 }), null, "opaque cross-origin timing is null, never a fake 0ms");
assert.strictEqual(core.ttfbOf(null), null);
assert.deepStrictEqual(core.serverTimingOf({ serverTiming: [{ name: "db", duration: 812.4, description: "query" }, { name: "render", duration: 40 }] }),
  [{ name: "db", ms: 812, desc: "query" }, { name: "render", ms: 40, desc: "" }]);
assert.strictEqual(core.serverTimingOf({ serverTiming: [] }), null, "no header -> null, not an empty list that reads like a measurement");
assert.strictEqual(core.serverTimingOf({}), null);
assert.strictEqual(core.entryKey({ kind: "lcp", url: "http://localhost:3000/tasks?x=1" }), "lcp /tasks", "LCP pairs across runs by page");
{
  const r = core.compareRuns([{ kind: "lcp", url: "/tasks", ms: 900 }, { kind: "lcp", url: "/tasks", ms: 1000 }],
                             [{ kind: "lcp", url: "/tasks", ms: 400 }, { kind: "lcp", url: "/tasks", ms: 420 }]);
  assert.strictEqual(r.rows[0].key, "lcp /tasks");
  assert.strictEqual(r.rows[0].verdict, "faster", "Compare reads LCP like any other ms metric");
}
{
  const src = codeOf(fs.readFileSync(MOD("measure.js"), "utf8"));
  assert.ok(/watch\("largest-contentful-paint", [\s\S]*?\}, true\);/.test(src), "LCP is observed buffered — recording starts long after the load it describes");
  assert.ok(/rec\.ttfbMs = core\.ttfbOf\(entry\)/.test(src), "a server-hit nav carries its TTFB");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `TypeError: core.ttfbOf is not a function`

- [ ] **Step 3: Implement in core.js**

In `entryKey`, directly below the `if (e.kind === "img") ...` line, add:

```js
    if (e.kind === "lcp") return "lcp " + normalisePath(e.url);
```

Add directly above `function firstFamily(value) {`:

```js
  // Pure: time to first byte, the server's think time. null when the browser
  // hides the timing (cross-origin without Timing-Allow-Origin zeroes both
  // fields), because a 0 here would read as "instant".
  function ttfbOf(entry) {
    if (!entry || !entry.requestStart || !entry.responseStart) return null;
    return Math.round(entry.responseStart - entry.requestStart);
  }

  // Pure: the Server-Timing header, when the app sends one. null when it does not.
  function serverTimingOf(entry) {
    var st = entry && entry.serverTiming;
    if (!st || !st.length) return null;
    return Array.prototype.map.call(st, function (s) { return { name: s.name, ms: Math.round(s.duration), desc: s.description || "" }; });
  }
```

Add `ttfbOf: ttfbOf, serverTimingOf: serverTimingOf,` to the export object.

- [ ] **Step 4: Implement in measure.js**

`core` is already in scope in measure.js; the code below calls `core.ttfbOf` and `core.serverTimingOf` directly.

In `settleNav`, replace:

```js
        if (entry) { rec.servedFromCache = false; rec.rscMs = Math.round(entry.duration); }
```

with:

```js
        if (entry) {
          rec.servedFromCache = false; rec.rscMs = Math.round(entry.duration);
          rec.ttfbMs = core.ttfbOf(entry); rec.serverTiming = core.serverTimingOf(entry);
        }
```

In `onUrlChange`, replace:

```js
        var rec = { t: stamp(), kind: "nav", from: from, to: to, servedFromCache: true, rscMs: null, toPaintMs: null };
```

with:

```js
        var rec = { t: stamp(), kind: "nav", from: from, to: to, servedFromCache: true, rscMs: null, ttfbMs: null, serverTiming: null, toPaintMs: null };
```

Replace the `watch` helper:

```js
      var watch = function (type, handler) {
        try {
          var o = new PerformanceObserver(handler);
          o.observe({ type: type, buffered: false });
          obs.push(o);
        } catch (e) {}
      };
```

with:

```js
      var watch = function (type, handler, buffered) {
        try {
          var o = new PerformanceObserver(handler);
          o.observe({ type: type, buffered: !!buffered });
          obs.push(o);
        } catch (e) {}
      };
```

In the `img` push, replace:

```js
            status: e.responseStatus != null ? e.responseStatus : null,
          });
```

with:

```js
            status: e.responseStatus != null ? e.responseStatus : null,
            serverTiming: core.serverTimingOf(e),
          });
```

Directly above `perfStop = function () {`, add:

```js
      // --- largest contentful paint ---
      // Buffered, because recording starts long after the load LCP describes.
      // One entry per recording, updated in place as later candidates arrive:
      // pushing every candidate would let Compare average the hero image with the
      // heading that painted before it.
      // ponytail: an entry drained by the watch loop before a later candidate
      // lands keeps the earlier value on the agent's side. LCP settles within a
      // few seconds of load and the loop drains every ~25s, so it rarely bites.
      var lcpRec = null;
      var loadPath = (performance.getEntriesByType("navigation")[0] || {}).name || location.href;
      watch("largest-contentful-paint", function (list) {
        var all = list.getEntries(), e = all[all.length - 1];
        if (!e) return;
        var ms = Math.round(e.startTime), el = e.element ? e.element.tagName.toLowerCase() : null;
        if (lcpRec) { lcpRec.t = ms; lcpRec.ms = ms; lcpRec.size = e.size; lcpRec.element = el; }
        else { lcpRec = { t: ms, kind: "lcp", url: loadPath, ms: ms, size: e.size, element: el }; buf.push(lcpRec); }
        notify();
      }, true);
```

Update the `console.log` in `start()` to:

```js
      console.log("[annotate] measure mode ON — recording navigations, actions, images, LCP, shifts, long tasks");
```

- [ ] **Step 5: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 6: Extend the gate**

Add above `// ---- checks end ----`:

```js
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
});
```

- [ ] **Step 7: Run the gate**

Expected: all checks `ok`, `phase3 gate: ok`. If the NOTE line prints, report it; it means the navigation check proved nothing this run and needs a route that is not cache-served.

- [ ] **Step 8: Commit**

```bash
git add skills/annotate/overlay/core.js skills/annotate/overlay/measure.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): Measure records LCP and the server's time to first byte"
```

---

### Task 8: Mark point

**Files:**
- Modify: `skills/annotate/overlay/core.js` (one line in `entryKey`)
- Modify: `skills/annotate/overlay/measure.js`
- Modify: `skills/annotate/overlay/ui.js`
- Modify: `skills/annotate/overlay/index.js`
- Test: `skills/annotate/overlay.test.cjs`
- Modify: `gates/phase3.gate.cjs`

**Interfaces:**
- Consumes: `ui.js` `cmpButton(act, label)` and `onAct(name, fn)` (existing).
- Produces:
  - `measureMode.mark(label: string) -> entry | null`: null when not recording.
  - Perf entry `{ t, kind: "mark", label }`. `core.entryKey` returns null for it, so Compare never makes it a row.
  - `ui.measurePanel`, `ui.setMeasureStatus(text)`, `ui.onMeasureMark(fn(label))`. The label field has `data-ann-measure-label`; the button has `data-ann-act="measure-mark"`.
  - `window.__annotatorMark(label) -> entry | null`
  - Alt+M marks without a label while in Measure (matched on `e.code === "KeyM"`, because Option+M on a Mac types `µ` into `e.key`).
  - `setModeTools(node)` no longer detaches a node that is already showing.

- [ ] **Step 1: Write the failing tests**

```js
// ---- Phase 3: mark point ----
assert.strictEqual(core.entryKey({ kind: "mark", label: "felt slow" }), null, "a mark is a timestamp, not a measurement");
{
  const r = core.compareRuns([{ kind: "mark", label: "a", t: 1 }, { kind: "action", url: "/a", ms: 10 }],
                             [{ kind: "mark", label: "b", t: 2 }, { kind: "action", url: "/a", ms: 10 }]);
  assert.deepStrictEqual(r.rows.map((x) => x.key), ["action /a"], "marks never become Compare rows");
}
{
  const ui = codeOf(fs.readFileSync(MOD("ui.js"), "utf8"));
  const idx = codeOf(fs.readFileSync(MOD("index.js"), "utf8"));
  // Measure repaints row 2 on EVERY recorded entry. Re-appending the same panel
  // detaches it, and a detached input loses focus mid-word.
  assert.ok(/row2\.firstChild === node/.test(ui), "setModeTools leaves an already-showing node in place");
  assert.ok(/data-ann-measure-label/.test(ui) && /"measure-mark"/.test(ui), "the measure panel has a label field and a Mark button");
  assert.ok(/window\.__annotatorMark = /.test(idx), "agent-side __annotatorMark exists");
  assert.ok(/e\.code === "KeyM"/.test(idx), "Alt+M matches on code, not key");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/annotate/overlay.test.cjs`
Expected: FAIL with `a mark is a timestamp, not a measurement` (entryKey currently returns `"mark"`).

- [ ] **Step 3: core.js**

In `entryKey`, directly below the `dropped` line, add:

```js
    if (e.kind === "mark") return null;                 // a timestamp to read against, not a measurement
```

- [ ] **Step 4: measure.js**

Replace:

```js
    var session = [], sessionDropped = 0;
```

with:

```js
    var session = [], sessionDropped = 0;
    var push = null, markSeq = 0;                     // push is set by start(); mark() needs it
```

In `start()`, replace:

```js
      session = []; sessionDropped = 0;
```

with:

```js
      session = []; sessionDropped = 0; markSeq = 0;
```

Directly below the closing `} };` of the `var buf = { push: ... }` block, add:

```js
      push = buf.push;
```

Directly above `function stop() {`, add:

```js
    // A labelled point in the trace: "this bit felt slow" becomes a timestamp the
    // agent reads against the entries around it, not a sentence to decode.
    // null when not recording: a mark outside a recording marks nothing.
    function mark(label) {
      if (!perfStop) return null;
      var text = String(label == null ? "" : label).trim().slice(0, 80);
      var e = { t: Math.round(performance.now()), kind: "mark", label: text || ("mark " + (++markSeq)) };
      push(e); notify();
      return e;
    }
```

Change the return line to:

```js
    return { start: start, stop: stop, take: take, size: size, sessionTake: sessionTake, mark: mark };
```

- [ ] **Step 5: ui.js**

Replace the start of `setModeTools`:

```js
    function setModeTools(node) {
      row2.textContent = "";
```

with:

```js
    function setModeTools(node) {
      // Handing over the node that is already showing is a repaint, not a swap.
      // Detaching it would blur a field mid-typing, and Measure repaints on every
      // recorded entry.
      if (node && row2.childNodes.length === 1 && row2.firstChild === node) { row2.style.display = "block"; return; }
      row2.textContent = "";
```

Directly below `function setCompareStatus(text) { cmpStatus.textContent = text || ""; }`, add:

```js
    // ---- measure panel: the running status, plus a labelled mark point ----
    var measurePanel = document.createElement("div"); measurePanel.className = "__ann-ui";
    Object.assign(measurePanel.style, { display: "flex", flexDirection: "column", gap: "6px", width: "380px", font: "12px " + SANS });
    var msStatus = document.createElement("div");
    Object.assign(msStatus.style, { color: pal.text2, font: "12px " + SANS });
    var msBar = document.createElement("div");
    Object.assign(msBar.style, { display: "flex", gap: "6px" });
    var msLabel = document.createElement("input"); msLabel.type = "text";
    msLabel.placeholder = "What just felt slow?  (Alt+M marks without a label)";
    msLabel.setAttribute("data-ann-measure-label", "");
    Object.assign(msLabel.style, { flex: "1", minWidth: "0", font: "12px " + SANS, padding: "6px 8px", borderRadius: "6px", border: "1px solid " + pal.border, background: pal.surface2, color: pal.text });
    msBar.append(msLabel, cmpButton("measure-mark", "Mark"));
    measurePanel.append(msStatus, msBar);
    function setMeasureStatus(text) { msStatus.textContent = text || ""; }
    var measureMarkHandler = null;
    function onMeasureMark(fn) { measureMarkHandler = fn; }
    function fireMark() { if (measureMarkHandler) measureMarkHandler(msLabel.value); msLabel.value = ""; }
    onAct("measure-mark", fireMark);
    msLabel.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); fireMark(); } });
```

In the returned object, directly below `comparePanel: comparePanel,`, add:

```js
      measurePanel: measurePanel,
      setMeasureStatus: setMeasureStatus,
      onMeasureMark: onMeasureMark,
```

- [ ] **Step 6: index.js**

Replace:

```js
      if (m === "measure") {
        uiHandles.setClickHint("Passes through (recording)");
        uiHandles.setModeTools(uiHandles.toolsText("Recording — clicks pass straight through · " + measureMode.size() + " entries"));
```

with:

```js
      if (m === "measure") {
        uiHandles.setClickHint("Passes through (recording)");
        uiHandles.setMeasureStatus("Recording — clicks pass straight through · " + measureMode.size() + " entries");
        uiHandles.setModeTools(uiHandles.measurePanel);
```

Directly above `// ui.js only knows it collected a note and a comma-separated tags string`, add:

```js
    // ---- Measure: mark point ----
    uiHandles.onMeasureMark(function (label) { measureMode.mark(label); });
```

Replace the Alt+A listener:

```js
    document.addEventListener("keydown", function (e) {
      if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggle(); }
    }, true);
```

with:

```js
    document.addEventListener("keydown", function (e) {
      if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggle(); }
      // e.code, not e.key: Option+M on a Mac puts "µ" in e.key.
      else if (e.altKey && e.code === "KeyM" && state.mode === "measure") { e.preventDefault(); measureMode.mark(""); }
    }, true);
```

Directly below `window.__annotatorPerfTake = function () { ... };`, add:

```js
    // Drops a labelled marker into the recording. null when Measure is not on.
    window.__annotatorMark = function (label) { return measureMode.mark(label); };
```

- [ ] **Step 7: Run the unit tests**

Run: `node skills/annotate/overlay.test.cjs`
Expected: `overlay.test: ok`

- [ ] **Step 8: Extend the gate**

Add above `// ---- checks end ----`:

```js
check("Mark drops labelled markers from the API, Alt+M and the toolbar, without stealing focus", async (page) => {
  await setMode(page, "measure");
  await page.evaluate(() => window.__annotatorPerfTake());
  await page.evaluate(() => window.__annotatorMark("gate api mark"));
  await page.fill("[data-ann-measure-label]", "gate typed");
  await page.evaluate(() => window.__annotatorMark("while typing"));      // notify() repaints row 2
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-ann-measure-label")),
    "the label field keeps focus through a repaint");
  await page.click('[data-ann-act="measure-mark"]');
  assert.strictEqual(await page.inputValue("[data-ann-measure-label]"), "", "the field clears after marking");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Alt+KeyM");
  const marks = (await page.evaluate(() => window.__annotatorPerfTake())).filter((e) => e.kind === "mark").map((e) => e.label);
  assert.deepStrictEqual(marks, ["gate api mark", "while typing", "gate typed", "mark 1"]);
  // There is no "off" tab: clicking the active tab is how you leave a mode.
  await page.evaluate(() => document.querySelector('[data-ann-mode="measure"]').click());
  assert.strictEqual(await page.evaluate(() => window.__annotator.mode), "off");
  assert.strictEqual(await page.evaluate(() => window.__annotatorMark("after")), null, "no mark outside a recording");
});
```

- [ ] **Step 9: Run the gate**

Expected: all checks `ok`, `phase3 gate: ok`.

- [ ] **Step 10: Sabotage check**

Delete the new first line of `setModeTools`. The gate's focus assertion must FAIL. Restore.

- [ ] **Step 11: Commit**

```bash
git add skills/annotate/overlay/core.js skills/annotate/overlay/measure.js skills/annotate/overlay/ui.js skills/annotate/overlay/index.js skills/annotate/overlay.test.cjs gates/phase3.gate.cjs
git commit -m "feat(annotate): drop a labelled mark into a Measure recording"
```

---

### Task 9: Docs, the voice decision, and the MCP-path check

**Files:**
- Modify: `skills/annotate/SKILL.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/PHASE3-LEDGER.md`

**Interfaces:**
- Consumes: every field and entry point named in Tasks 2–8.

- [ ] **Step 1: SKILL.md, Setup step 5, the Point bullet**

Replace the Point bullet (starting `- **Point** — hover highlights the element`) with:

```markdown
   - **Point** — hover highlights the element **and shows an inspector card** (computed
     font/size/color/padding/etc.), click opens a comment box, **⌘/Ctrl+Enter** or **Save**
     submits. The screenshot is taken **the instant he clicks**, before the box opens, so a
     tooltip or an open dropdown is in it. In the box, **↑ / ↓** (or **Alt+↑ / Alt+↓**) move
     the comment to the parent element and back, for when the click landed on a `<span>`
     inside the thing he means. **⌘/Ctrl+click** gathers several elements into one comment
     (dashed outlines; Escape drops them). He can **⌘V a screenshot** of his own or **drag an
     image file onto the box**. **Hold Shift to "peek"**, clicking through for one action
     without leaving the mode.
```

- [ ] **Step 2: SKILL.md, Measure section**

Replace the table and the paragraph above it (from `Entries come back on the same poll, in \`perf\`. Five kinds` through the `longtask` row) with:

```markdown
Row 2 shows the running entry count and a **Mark** field: type what just felt slow and press
Enter or **Mark**, or press **Alt+M** for an unlabelled mark. From the agent side:
`() => window.__annotatorMark("label")` (returns the entry, or `null` when Measure is off).

Entries come back on the same poll, in `perf`. Each has `t` (ms since page load):

| kind | fields | what it tells you |
|------|--------|-------------------|
| `nav` | `from`, `to`, `servedFromCache`, `rscMs`, `ttfbMs`, `serverTiming`, `toPaintMs` | Client-side route change. `servedFromCache: true` means the click needed **no** server request. Detected from the browser's own resource timings by looking **backward** for a `?_rsc=` request — Next starts that request *before* it pushes the URL, and does not route it through `window.fetch`. **`ttfbMs` is the server's think time** (request sent to first byte); `rscMs` also includes the download. `serverTiming` is the app's `Server-Timing` header as `[{ name, ms, desc }]`, or `null` when it sends none (Tideswell sends none). |
| `action` | `url`, `ms`, `ok` | A Server Action (e.g. sending a message), spotted by its `Next-Action` header. `ms` is time to response headers — the server's thinking time. |
| `img` | `url`, `ms`, `ttfbMs`, `transferSize`, `decodedBodySize`, `status`, `serverTiming` | A chat attachment. **`ms` is the trustworthy field** — it covers the whole two-hop redirect. `ttfbMs`, `transferSize`, `decodedBodySize` and `status` read `0` whenever the request redirects cross-origin to storage, because that origin sends no `Timing-Allow-Origin` header. Do not read `transferSize: 0` as a cache hit here. |
| `lcp` | `url`, `ms`, `size`, `element` | Largest contentful paint of the **page load** — when the main content appeared. One per recording, read from the browser's buffer, so it is there even though recording started after load. |
| `mark` | `label` | Matt (or you) marking a moment. Not a measurement: read the entries whose `t` sits just before it. Compare ignores marks. |
| `shift` | `value` | The page jumping (e.g. an image landing with no space reserved). |
| `longtask` | `ms` | The main thread blocked — the browser, not the server. |
```

In the Measure **Ceilings** paragraph, append:

```markdown
LCP describes the hard page load only: client-side navigations produce none. If the watch
loop drains the `lcp` entry before a later, larger paint lands, you keep the earlier value.
Actions have no `ttfbMs`: their resource timing is only written once the body has been read,
which is after the point `ms` measures.
```

- [ ] **Step 3: SKILL.md, watch loop step 2**

Replace the annotation shape line `2. **For each annotation in \`anns\`** \`{ id, n, selector, descriptor, comment, url, hasImage }\`:` with:

```markdown
2. **For each annotation in `anns`** `{ id, n, selector, descriptor, others, comment, url, hasImage, hasShot, context }`:
```

Replace the **Screenshot it** bullet with:

```markdown
   - **Look at what he saw**: if `hasShot`, pull the click-time screenshot exactly like an
     attachment, with id `"<id>-shot"` (`__annotatorImageTake("<id>-shot")` through
     `browser_evaluate`'s `filename`, never inline). It was taken the moment he clicked, so
     tooltips and open menus are in it; the highlight ring marks what he clicked. If
     `hasShot` is false (the fallback boot path has no screenshot binding), fall back to
     `() => window.__annotatorReveal("<id>")` then `browser_take_screenshot`.
```

Replace the **Find the source** bullet with:

```markdown
   - **Find the source**: `descriptor.source` is `{ file, line, column, via }`, already the
     nearest file in the app's own code (library components are skipped). Go straight to
     that `file:line`. `via: "next-dev"` came from Next's dev server; it is only available on a
     Next App Router dev server. If `source` is `null`, grep for the component:
     `descriptor.components` lists the owning components nearest first, so
     `function <components[0]>` or `const <components[0]>` usually finds the file. After that,
     `descriptor.text`, `descriptor.className`, or a `data-*`/`aria-label` from
     `descriptor.attrs`, scoped by `url`. Confident → fix. Two candidates → show Matt, he picks.
   - **`others`** (⌘-click) is the same `{ selector, descriptor }` for each extra element. One
     comment, several places: fix them together.
   - **`context`** is `{ windowMs, errors, failedRequests }`: the page's `console.error`s,
     uncaught errors, rejected promises, and failed `fetch`/image/script loads **in the 30
     seconds before he saved**. Page-wide, not per element. When it is non-empty, read it
     before guessing at a cause. XHR failures are not captured.
```

- [ ] **Step 4: SKILL.md, Notes / ceilings**

Delete the bullet that begins `- Screenshots are **process-time**, not save-time`.

Add at the end of the Notes list:

```markdown
- **Voice was dropped** (2026-09-17, spec §6.1's timebox). Tideswell sends
  `Permissions-Policy: microphone=()`, which forbids microphone access on every page of the
  app Point exists for, so no in-page recorder can work there. macOS Dictation types into any
  focused text field, the comment box included, with no code from this tool.
- **A comment reaches the agent up to 1.5s after Save.** It is saved and badged at once, then
  held back (`status: "resolving"`) until its source lookup settles. A reload in that window
  hands it over without a source, never loses it.
```

- [ ] **Step 5: HANDOFF.md**

Replace the `## Resume here` section body with:

```markdown
Phase 3 is complete: Compare (see PHASE3-LEDGER.md) and the Point / Measure upgrades
(source lookup on React 19, click-time screenshots, tree walk, multi-select, recent errors,
LCP, TTFB, mark point). Voice was dropped with evidence. **Phase 4 is next** (MCP server,
framework adapters, install, licensing) and is blocked on the licensing question below.
Write a plan before touching it.
```

In `## Decisions waiting for Matt`, replace item 2 (`**A link cannot be favourited.**`) with:

```markdown
2. ~~A link cannot be favourited.~~ **Fixed 2026-08-07:** Alt+click pins without navigating.
```

In `## Open problems`, delete problem 1 (`A link can't be favourited`) and renumber the rest.

- [ ] **Step 6: PHASE3-LEDGER.md**

Append:

```markdown

## Point and Measure (2026-09-17)

Plan: `docs/superpowers/plans/2026-09-17-annotate-phase3-point-measure.md`.

**Verified before building, not after.** React 19.2 has no `_debugSource`; every fiber has
`_debugOwner` and `_debugStack`. Next 16's `POST /__nextjs_original-stack-frames` resolves
server frames as sent and client frames once rewritten into the dist dir, percent-decoded.
A page-triggered `exposeBinding` screenshot took 28ms. Tideswell forbids the microphone.

**Shipped:** source file + component names on every comment; click-time screenshot;
Alt+↑/↓ tree walk; ⌘/Ctrl+click multi-select; page errors and failed requests from the last
30s; `lcp` entries; `ttfbMs` and `serverTiming` on navs; `mark` entries from the API, Alt+M and
the toolbar.

**Decisions worth keeping.**
- Multi-select is ⌘/Ctrl, not the spec's Shift: Shift is Point's peek.
- Source lookup is Next App Router dev only. Everything else gets component names and a grep.
- Context is page-wide. The spec said "the element's console errors"; no browser API can
  attribute an error to an element, so the label says what it is.
- Voice dropped: `Permissions-Policy: microphone=()` on the target app. macOS Dictation covers it.
- `setModeTools` no longer re-appends a showing node. Found while adding the Mark field:
  Measure repaints on every entry, and re-appending blurred the input mid-word. The Study
  favourite panel had the same latent bug.

**Verification:** `overlay.test.cjs` green; `gates/phase3.gate.cjs` green against
Tideswell `/login` with zero page errors. Record here which sabotage checks fired and any
gate NOTE lines.
```

- [ ] **Step 7: Run everything**

```bash
node skills/annotate/overlay.test.cjs
PLAYWRIGHT=/Users/mattjones/Documents/brandscout-enterprise/node_modules/.pnpm/@playwright+test@1.60.0/node_modules/playwright node gates/phase3.gate.cjs
```

Expected: `overlay.test: ok` and `phase3 gate: ok`. Fill in the ledger's last paragraph with what actually happened.

- [ ] **Step 8: The MCP-path check**

The gate registers the binding with plain Playwright. SKILL.md registers it through `browser_run_code_unsafe`, whose snippet runs in a bare `vm` sandbox. Whether a callback defined in that sandbox still works after the tool call returns has not been observed. If the Playwright MCP browser is free, run SKILL.md's boot snippet through `browser_run_code_unsafe` against `http://localhost:3000/login`, then `browser_evaluate` → `async () => (await window.__annotatorShoot()).slice(0, 30)`. Expected: `data:image/jpeg;base64,/9j/4AA`. If the browser is held by another session, say so in the ledger as unexercised, the same way the CSP finding was recorded.

- [ ] **Step 9: Commit**

```bash
git add skills/annotate/SKILL.md docs/HANDOFF.md docs/PHASE3-LEDGER.md
git commit -m "docs(annotate): Phase 3 Point and Measure, and why voice was dropped"
```

---

## Out of scope

- **Framework adapters** for Measure's navigation detection (spec §6.2): Phase 4.
- **Source lookup outside Next App Router dev** (Vite, Pages Router, production): component names and grep cover it until a real user needs more.
- **XHR failure capture**: `fetch` covers Tideswell.
