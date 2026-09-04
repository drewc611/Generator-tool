import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fieldsFromIr } from "../plugins/dsp-forms/index.js";
import { renderSchema } from "../plugins/output-forms/index.js";
import { grade, auditCopy, auditIr, auditSource, auditLanguage, summarizeCopy } from "../plugins/dsp-cognitive/index.js";
import { deriveDark } from "../plugins/dsp-uplift/index.js";
import { ratio } from "../plugins/dsp-uplift/color.js";
import { auditDates } from "../plugins/dsp-dates/index.js";
import { auditFlags } from "../plugins/dsp-flags/index.js";
import { auditPerf } from "../plugins/dsp-perf/index.js";
import { inferEntities } from "../plugins/dsp-entities/index.js";
import { compare } from "../plugins/dsp-diff/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { runPipeline } from "./helpers.js";

/* -------------------------------------------------------------- dsp-forms */

test("constraints are read off the markup, conditional ones marked as such", () => {
  const { fields, submits } = fieldsFromIr(buildIr(`
    <form>
      <input name="email" type="email" required maxlength="80">
      <input name="qty" type="number" min="1">
      <input name="ref" ng-required="isTrade">
      <button type="submit">Save</button>
    </form>`));
  assert.equal(submits >= 1, true);
  const email = fields.find((f) => f.name === "email");
  assert.equal(email.constraints.required, true);
  assert.equal(email.constraints.type, "email");
  const ref = fields.find((f) => f.name === "ref");
  assert.ok(ref.constraints.required.conditional, "a bound constraint is conditional, and says so");
});

test("an observed complaint becomes an enforced rule, in the app's own words", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ forms: true, src: join(process.cwd(), "example/nosource"), shots: join(process.cwd(), "test/fixtures/explored") });
  t.after(cleanup);
  const schema = ctx.written.find((f) => /src\/forms\/.*schema\.js$/.test(f));
  assert.ok(schema, "a schema was emitted");
  const source = await readFile(join(out, schema), "utf8");
  assert.match(source, /Customer is required/, "the message is the app's, not a synonym");
  assert.match(source, /kind: "required"/, "and it is enforced, not only quoted");
});

/* ---------------------------------------------------------- dsp-cognitive */

test("dense copy is a number, not a judgment", () => {
  assert.ok(grade("Save your work.") < 6);
  const findings = auditCopy([{ key: "x", value: "Utilization of the aforementioned functionality necessitates preliminary administrative authorization procedures immediately." }]);
  assert.ok(findings.some((f) => f.kind === "hard-copy"));
});

test("a control that is only an icon is the serious finding", () => {
  const withLabel = auditIr(buildIr(`<button aria-label="Refresh"><i class="ico"></i></button>`), "s");
  const without = auditIr(buildIr(`<button (click)="go()"><i class="ico"></i></button>`), "s");
  assert.equal(withLabel.filter((f) => f.kind === "icon-only-control").length, 0);
  assert.equal(without.filter((f) => f.kind === "icon-only-control").length, 1);
  assert.equal(without[0].severity, "high");
});

test("a link that names no destination is a finding; one that does is not", () => {
  const vague = auditIr(buildIr(`<p><a href="/help">click here</a></p>`), "s");
  const named = auditIr(buildIr(`<p><a href="/help">Delivery help</a></p>`), "s");
  assert.equal(vague.filter((f) => f.kind === "vague-link").length, 1);
  assert.equal(named.filter((f) => f.kind === "vague-link").length, 0);
});

test("the language audit counts what it sees and never grades tone", () => {
  const wall = auditLanguage([{ key: "k", value: Array(90).fill("word").join(" ") }]);
  assert.equal(wall.filter((f) => f.kind === "wall-of-text").length, 1);

  const abbr = auditLanguage([
    { key: "a", value: "Submit the RTAO form." }, { key: "b", value: "RTAO forms arrive Monday." }, { key: "c", value: "Late RTAO forms wait." },
  ]);
  assert.ok(abbr.some((f) => f.kind === "unexplained-abbreviation" && /RTAO appears 3/.test(f.evidence)));
  const explained = auditLanguage([
    { key: "a", value: "Return To Area Office (RTAO) forms. RTAO forms arrive Monday. Late RTAO forms wait." },
  ]);
  assert.ok(!explained.some((f) => f.kind === "unexplained-abbreviation"), "an expansion beside the letters counts");

  const mixed = auditLanguage([], new Map([["a", ["Submit"]], ["b", ["Send"]], ["c", ["Go"]]]));
  assert.ok(mixed.some((f) => f.kind === "inconsistent-actions" && f.evidence.includes('"Send"')));
  assert.ok(!auditLanguage([], new Map([["a", ["Submit"]], ["b", ["Submit"]]])).some((f) => f.kind === "inconsistent-actions"));
});

test("the copy summary is a count and a median, said with its limits", () => {
  const s = summarizeCopy([{ key: "a", value: "Save your work." }, { key: "b", value: "Print the label." }]);
  assert.equal(s.strings, 2);
  assert.ok(s.words >= 6);
  assert.ok(typeof s.medianGrade === "number");
});

test("a session timer is found by what it does, not by a keyword list alone", () => {
  const found = auditSource(`setTimeout(function () { forceLogout(); }, 900000);`, "a.js");
  assert.ok(found.some((f) => f.kind === "session-timer"));
  assert.deepEqual(auditSource(`setTimeout(render, 16);`, "a.js"), [], "a frame tick is not a session timer");
});

/* ---------------------------------------------------------- the dark side */

test("the dark palette keeps every hue and proves every pair", () => {
  const light = {
    bg: "#FBFAF8", surface: "#FFFFFF", sunken: "#F4F2EE", line: "#E3DFD8",
    ink: "#1C1B19", inkMuted: "#6B675F", inkFaint: "#969187",
    accent: "#004B87", danger: "#A3231F", warn: "#8A5A0B", ok: "#1F6B4A",
  };
  const { color, changes } = deriveDark(light);
  for (const change of changes) assert.ok(change.ok, `${change.role} on ${change.ground} reaches ${change.after}:1, wanted ${change.target}:1`);
  assert.ok(ratio(color.ink, color.surface) > ratio(color.inkMuted, color.surface), "the ink hierarchy survives inversion");
});

/* ----------------------------------------------- the four pattern audits */

test("date findings are the ones that change answers", () => {
  const kinds = auditDates(`fmt("DD/MM/YYYY"); new Date("03/04/2024"); x = d.getMonth() + 1 + "/";`, "a.js").map((f) => f.kind);
  assert.ok(kinds.includes("ambiguous-format"));
  assert.ok(kinds.includes("string-parsed"));
  assert.deepEqual(auditDates(`const when = new Date(timestamp);`, "b.js"), [], "a timestamp parse is fine");
});

test("a flag is a switch shaped name in a condition, and nothing looser", () => {
  const found = auditFlags(`if (enableNewCheckout) {} const color = enabledColor; if (color) {}`, "a.js");
  assert.ok(found.has("enableNewCheckout"));
  assert.ok(!found.has("color"));
});

test("perf findings say which claim the scan can make", () => {
  const found = auditPerf(`rows.forEach(function (r) { $.get("/api/x/" + r.id); });`, "a.js");
  assert.equal(found[0].kind, "request-in-loop");
  assert.match(found[0].why, /proves the shape, not the count/);
});

/* ------------------------------------------------------------ dsp-entities */

test("two shapes that mostly agree are one entity; a type conflict is named", () => {
  const entities = inferEntities([
    { endpoint: "GET /api/orders", properties: { id: "string", total: "number", customer: "string" } },
    { endpoint: "GET /api/orders/{id}", properties: { id: "string", total: "string", customer: "string", notes: "string" } },
    { endpoint: "GET /api/users", properties: { email: "string", name: "string" } },
  ]);
  assert.equal(entities.length, 2);
  const order = entities.find((e) => e.name === "order");
  assert.deepEqual(Object.keys(order.properties).sort(), ["customer", "id", "notes", "total"]);
  assert.ok(order.conflicts.some((c) => /total/.test(c)), "number vs string on total is a finding");
});

/* ---------------------------------------------------------------- dsp-diff */

test("a diff reports what moved and stays quiet when nothing did", () => {
  const a = { screens: [{ name: "orders" }], endpoints: [{ method: "GET", path: "/api/a" }], unverified: [], tokens: { color: { accent: "#111111" } } };
  const b = { screens: [{ name: "orders" }, { name: "billing" }], endpoints: [{ method: "GET", path: "/api/a" }, { method: "POST", path: "/api/b" }], unverified: ["x"], tokens: { color: { accent: "#222222" } } };
  const delta = compare(a, b);
  assert.deepEqual(delta.screens.added, ["billing"]);
  assert.deepEqual(delta.endpoints.added, ["POST /api/b"]);
  assert.ok(delta.tokens[0].includes("accent"));
  assert.equal(compare(a, a).quiet, true);
});
