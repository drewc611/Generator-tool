import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseInformix, parseAttributes, findScreenBlock, splitSections, tokenizeRow } from "../plugins/input-informix/parse.js";
import { lowerInformix } from "../plugins/input-informix/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Informix 4GL/ESQL's `.per` screen form files, the character-cell terminal
 * screen format Informix products have written since the 1980s. A SCREEN
 * section's `{ ... }` block is literal ASCII art: row and column position is
 * the layout itself, so this reader reads a grid of characters rather than
 * building a container tree, the one genuinely different structural approach
 * among this tool's readers. There is no button, no submit, no event
 * anywhere in the format, so it lowers to zero outputs, the same honest zero
 * input-jasperreports and input-birt already establish for a document with
 * nothing to wire.
 */

function lower(src, rel = "screen.per") {
  const notes = [];
  const lowered = lowerInformix(parseInformix(src), rel, (n) => notes.push(n));
  if (lowered) lowered.notes = [...notes, ...lowered.notes];
  return lowered;
}

test("a heading, an enterable field and a NOENTRY field all lower onto the dialect", () => {
  const src = `SCREEN
{
Customer Maintenance
Name: [f002          ]
Status: [f005]
}

ATTRIBUTES
f002 = customer.fname;
f005 = customer.active_flag, NOENTRY;
`;
  const lowered = lower(src);
  assert.match(lowered.template, /<h2>Customer Maintenance<\/h2>/);
  assert.match(lowered.template, /Name: <input id="f-fname" type="text" ng-model="fname">/);
  assert.match(lowered.template, /Status: <span>\{\{ active_flag \}\}<\/span>/, "a NOENTRY field reads as a bare interpolation, never an editable input");
  assert.deepEqual(lowered.fields, ["fname"], "only the enterable field is the screen's own two-way state");
  assert.deepEqual(lowered.outputs, [], "a .per file names no event anywhere");
  assert.equal(detectDialect(lowered.template).name, "angularjs");
});

test("REQUIRED is noted for the port to enforce, never emitted as an HTML required attribute", () => {
  const src = `SCREEN
{
[f001    ]
}

ATTRIBUTES
f001 = customer.customer_num, REQUIRED, COMMENTS = "The unique customer id";
`;
  const lowered = lower(src);
  assert.doesNotMatch(lowered.template, /\brequired\b/i, "REQUIRED never becomes an HTML required attribute");
  assert.match(lowered.template, /title="The unique customer id"/, "COMMENTS is carried across as a title attribute");
  assert.ok(lowered.notes.some((n) => /`f001` \(customer_num\) is marked required; the port must enforce this itself/.test(n)));
});

test("a field tag reused across two placeholder rows is one field, rendered once", () => {
  const src = `SCREEN
{
[f006                    ]
[f006                    ]
}

ATTRIBUTES
f006 = customer.notes, NOENTRY;
`;
  const lowered = lower(src);
  const occurrences = lowered.template.match(/\{\{ notes \}\}/g) ?? [];
  assert.equal(occurrences.length, 1, "the wrapped second row of the same field renders nothing a second time");
});

test("a SCREEN placeholder with no ATTRIBUTES statement is named and rendered as a plain enterable field", () => {
  const src = `SCREEN
{
[f009]
}
`;
  const lowered = lower(src);
  assert.match(lowered.template, /<input id="f-f009" type="text" ng-model="f009">/);
  assert.ok(lowered.notes.some((n) => /`f009` appears on screen with no declared table or column binding/.test(n)));
});

test("an ATTRIBUTES statement whose tag never appears on screen is named, not silently dropped", () => {
  const src = `SCREEN
{
[f001]
}

ATTRIBUTES
f001 = customer.customer_num;
f008 = customer.zip_code;
`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /`f008` \(zip_code\) has a declared table or column binding but never appears anywhere on screen/.test(n)));
});

test("an unrecognised ATTRIBUTES modifier is named rather than guessed", () => {
  const src = `SCREEN
{
[f001]
}

ATTRIBUTES
f001 = customer.customer_num, WEIRDMOD;
`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the modifier `WEIRDMOD` on `f001` is not one this reader recognises/.test(n)));
});

test("REVERSE and other visual modifiers change nothing about the rendered element", () => {
  const src = `SCREEN
{
[f002]
}

ATTRIBUTES
f002 = customer.fname, REVERSE;
`;
  const lowered = lower(src);
  assert.match(lowered.template, /<input id="f-fname" type="text" ng-model="fname">/);
  assert.doesNotMatch(lowered.template, /reverse/i);
});

test("a SCREEN section with no matching closing brace is named as unreadable, never thrown", () => {
  const src = `SCREEN
{
[f001]
`;
  assert.doesNotThrow(() => lower(src));
  const lowered = lower(src);
  assert.equal(lowered, null);
});

test("no SCREEN section at all is named, never guessed at", () => {
  const lowered = lower("DATABASE stores7\n");
  assert.equal(lowered, null);
});

test("a screen row that starts with a section keyword inside the SCREEN block is never mistaken for a new section", () => {
  const src = `SCREEN
{
TABLES OF CONTENTS
[f001]
}

ATTRIBUTES
f001 = customer.customer_num;
`;
  const sections = splitSections(src);
  assert.equal(sections.filter((s) => s.keyword === "TABLES").length, 0, "no real TABLES section exists in this fixture");
  const screen = findScreenBlock(sections);
  assert.ok(screen.rows.some((r) => r.includes("TABLES OF CONTENTS")), "the screen-art line survived inside the SCREEN block's own rows");
});

test("parseAttributes reads COMMENTS with an embedded comma without splitting it", () => {
  const attrs = parseAttributes(['f001 = customer.customer_num, COMMENTS = "id, unique";']);
  assert.equal(attrs.get("f001").comments, "id, unique");
});

test("tokenizeRow reads literal text and bracketed field tags in left to right order", () => {
  const tokens = tokenizeRow("Customer Number: [f001    ]      Name: [f002    ]");
  assert.deepEqual(tokens, [
    { kind: "text", value: "Customer Number:" },
    { kind: "field", tag: "f001" },
    { kind: "text", value: "Name:" },
    { kind: "field", tag: "f002" },
  ]);
});

test("a customer.per screen form ports to React through the unchanged pipeline, with no .per syntax leaking", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/informix") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "informix");
    assert.ok(screen, "the Informix screen form was read");
    assert.deepEqual(screen.outputs, [], "a .per file has no events to wire");

    const jsx = await readFile(join(run.out, "src/features/Customer/Customer.jsx"), "utf8");
    assert.match(jsx, /Customer Maintenance/);
    assert.match(jsx, /ng-model="fname"|value=\{fname\}/i);
    assert.match(jsx, /active_flag|activeFlag/i, "the NOENTRY field's column name survived as a read only value");
    assert.match(jsx, /The unique customer id/, "COMMENTS survived as a title");

    const md = await readFile(join(run.out, "INFORMIX.md"), "utf8");
    assert.match(md, /customer\.per/);
    assert.match(md, /Also present, not read for meaning: DATABASE, TABLES, INSTRUCTIONS\./);
    assert.ok(run.ctx.report.unverified.some((n) => /f009.*no declared table or column binding/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /f008.*never appears anywhere on screen/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /f001.*is marked required/.test(n)));

    // Nothing this reader read as raw .per syntax should ever reach the port or its own report.
    const FORBIDDEN = /\bATTRIBUTES\b|\bNOENTRY\b|\bREQUIRED\b|COMMENTS\s*=|\[f001|customer\.customer_num|customer\.active_flag/;
    assert.doesNotMatch(jsx, FORBIDDEN);
    assert.doesNotMatch(md, FORBIDDEN);
  } finally {
    await run.cleanup();
  }
});
