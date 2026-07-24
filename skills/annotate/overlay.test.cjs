// Self-check for the one piece of tricky logic in overlay.js: buildSelector.
// Loads the file with a fake `module` so the UMD tail exports (never auto-runs
// setup, so no window/document needed). Run: node .claude/skills/annotate/overlay.test.cjs
const fs = require("node:fs");
const assert = require("node:assert");

const src = fs.readFileSync(__dirname + "/overlay.js", "utf8");
const mod = { exports: {} };
new Function("module", src)(mod); // takes the CJS branch → mod.exports = api
const { buildSelector } = mod.exports;

// Fake DOM nodes: just what buildSelector reads.
function el(tag, id) { return { nodeType: 1, tagName: tag.toUpperCase(), id: id || "", parentElement: null, children: [] }; }
function child(parent, node) { node.parentElement = parent; parent.children.push(node); return node; }

const app = el("div", "app");
const ul = child(app, el("ul"));
child(ul, el("li"));                 // li #1
const li2 = child(ul, el("li"));     // li #2 (target)
child(ul, el("li"));                 // li #3

assert.strictEqual(buildSelector(li2), "#app > ul > li:nth-of-type(2)", "nth-of-type path + id anchor");
assert.strictEqual(buildSelector(el("section", "hero")), "#hero", "id short-circuits");
assert.strictEqual(buildSelector(null), "", "null -> empty");

console.log("overlay.test: ok");
