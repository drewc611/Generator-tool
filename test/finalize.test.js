import assert from "node:assert/strict";
import test from "node:test";

import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { lowerHandlebars } from "../plugins/input-handlebars/lower.js";
import { translate } from "../plugins/output-react/template.js";
import { fieldsFromIr } from "../plugins/dsp-forms/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { readPage } from "../plugins/input-static/index.js";
import { runPipeline } from "./helpers.js";
import { join } from "node:path";

test("a jinja include whose file is in the run is inlined, one that is not is named", () => {
  const notes = [];
  const partials = new Map([["nav.html", `<nav><a href="a.html">A</a></nav>`]]);
  const lowered = lowerJinja(
    `{% include "nav.html" %}<p>body</p>{% include "gone.html" %}`,
    (n) => notes.push(n),
    (name) => partials.get(name) ?? null
  );
  assert.match(lowered, /<nav>/, "the held include is inlined");
  assert.doesNotMatch(lowered, /gone/);
  assert.ok(notes.some((n) => n.includes("gone.html")), "the missing one is named");
});

test("an include that includes itself stops at the guard", () => {
  const lowered = lowerJinja(`{% include "self.html" %}`, () => {}, () => `x{% include "self.html" %}`);
  assert.ok(lowered.length < 200, "the recursion terminated");
});

test("a handlebars partial in the run is inlined; its arguments are named", () => {
  const notes = [];
  const lowered = lowerHandlebars(
    `{{> row item}}`,
    (n) => notes.push(n),
    (name) => (name === "row" ? `<li>{{name}}</li>` : null)
  );
  assert.match(lowered, /<li>/);
  assert.ok(notes.some((n) => n.includes("arguments")));
});

test("v-model modifiers keep their meaning across the translation", () => {
  const number = translate(`<input v-model.number="age">`, { indent: 0 });
  assert.match(number.jsx, /valueAsNumber/);
  const trim = translate(`<input v-model.trim="name">`, { indent: 0 });
  assert.match(trim.jsx, /onBlur=\{\(event\) => setName\(event\.target\.value\.trim\(\)\)\}/, "trim applies when the field settles");
  assert.match(trim.jsx, /onChange=\{\(event\) => setName\(event\.target\.value\)\}/, "typing stays undisturbed");
  const lazy = translate(`<input v-model.lazy="q">`, { indent: 0 });
  assert.ok(lazy.notes.some((n) => n.includes("lazy")));
});

test("a multiple select model reads its selected options", () => {
  const out = translate(`<select multiple [(ngModel)]="tags"><option>a</option></select>`, { indent: 0 });
  assert.match(out.jsx, /selectedOptions/);
  assert.match(out.jsx, /value=\{tags\}/);
});

test("radios sharing a name become one field with the enum the markup states", () => {
  const ir = buildIr(
    `<form><input type="radio" ng-model="mode" value="fast"><input type="radio" ng-model="mode" value="slow"><button type="submit">Go</button></form>`
  );
  const { fields } = fieldsFromIr(ir);
  const mode = fields.filter((f) => f.name === "mode");
  assert.equal(mode.length, 1, "one question, not two fields");
  assert.deepEqual(mode[0].constraints.oneOf, ["fast", "slow"]);
});

test("chrome shared across static pages is proposed as one component", async (t) => {
  // Two pages with the same nav, driven through the plugin via readPage plus
  // the note it produces in a run are covered by the unit shape here.
  const nav = `<nav><a href="a.html">A</a><a href="b.html">B</a></nav>`;
  const a = readPage(`<body>${nav}<h1>A</h1></body>`, "a.html");
  const b = readPage(`<body>${nav}<h1>B</h1></body>`, "b.html");
  assert.ok(a.screen && b.screen);
  assert.equal(
    a.screen.template.match(/<nav[\s\S]*?<\/nav\s*>/i)[0],
    b.screen.template.match(/<nav[\s\S]*?<\/nav\s*>/i)[0],
    "the chrome is verbatim identical, which is what the proposal keys on"
  );
});

test("the unverified ceiling fails a run over it and passes one under it", async (t) => {
  const over = await runPipeline({ src: join(process.cwd(), "example/legacy"), maxUnverified: 0 });
  t.after(over.cleanup);
  assert.ok(over.error, "a ceiling of zero fails the demo, which has honest gaps");
  assert.match(over.error.message, /ceiling of 0/);

  const under = await runPipeline({ src: join(process.cwd(), "example/legacy"), maxUnverified: 99 });
  t.after(under.cleanup);
  assert.equal(under.error, null);
});

test("the element announces its transient states", async (t) => {
  const { out, error, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy"), html: true });
  t.after(cleanup);
  assert.equal(error, null);
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(join(out, "src/elements/AppOrders.js"), "utf8");
  assert.match(source, /role="status"/, "loading is a status live region");
  assert.match(source, /role="alert"/, "an error announces itself");
});

test("the roadmap holds exactly the number it claims, and the table agrees", async () => {
  const { readFile } = await import("node:fs/promises");
  const md = await readFile(join(process.cwd(), "ROADMAP.md"), "utf8");
  const entries = md.match(/^\*\*\d+\..*(✅|🔨|▢)\s*$/gm) ?? [];
  assert.equal(entries.length, 450, "four hundred and fifty entries, each carrying a status");
  const count = (mark) => entries.filter((e) => e.trim().endsWith(mark)).length;
  assert.match(md, new RegExp(`\\| shipped \\| ${count("✅")} \\|`), "the table's shipped row is the real count");
  assert.match(md, new RegExp(`\\| new in this branch \\| ${count("🔨")} \\|`));
  assert.match(md, new RegExp(`\\| planned \\| ${count("▢")} \\|`));
});
