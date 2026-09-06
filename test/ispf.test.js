import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseIspf, parseAttrSection, tokenizeRow, effectiveAttrMap } from "../plugins/input-ispf/parse.js";
import { lowerIspf } from "../plugins/input-ispf/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * IBM ISPF Dialog Manager `.panel` definitions, the format that has laid out
 * every full screen TSO/ISPF dialog on IBM mainframes since the 1980s. A
 * `)BODY` section is literal ASCII art the same way input-informix's own
 * SCREEN block is: position comes from where each run of text sits in the
 * row, not a coordinate attribute the way BMS's `POS=(row,col)` is. The
 * variable a `TYPE(INPUT)`/`TYPE(OUTPUT)` run binds to is read directly off
 * the body text itself, ISPF's own convention and a genuinely different
 * naming mechanism from every other reader this tool carries.
 */

test("a TYPE(TEXT) run becomes a plain caption, never an input", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 _ TYPE(INPUT)
)BODY
%CUSTOMER MAINTENANCE
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.match(lowered.title, /CUSTOMER MAINTENANCE/);
  assert.doesNotMatch(lowered.template, /<input|ng-model/);
  assert.deepEqual(lowered.fields, []);
});

test("a TYPE(INPUT) run's body text is read as the variable name it binds to, ISPF's own naming convention", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 _ TYPE(INPUT)
)BODY
%Cust No ===>_ZCUSTNO
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.match(lowered.template, /<input id="f-zcustno" type="text" ng-model="zcustno">/);
  assert.deepEqual(lowered.fields, ["zcustno"]);
  assert.equal(lowered.usesTwoWay, true);
  // the arrow is plain literal text belonging to the preceding caption, never stripped or treated as its own field
  // (HTML escaped along with the rest of the caption, the same as every other reader's literal text)
  assert.match(lowered.template, /Cust No ===&gt;/);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a TYPE(OUTPUT) run becomes a read only interpolation, the same honest treatment input-informix gives NOENTRY", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 # TYPE(OUTPUT)
)BODY
%Status  ===>#ZSTATUS
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.match(lowered.template, /<span>\{\{ zstatus \}\}<\/span>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, [], "an OUTPUT run is a value the screen is handed, never its own editable state");
});

test("an )ATTR character declared with no TYPE(...) is named through a note rather than guessed, and rendered as nothing", () => {
  const { map, notes } = parseAttrSection([" @ COLOR(BLUE)"]);
  assert.equal(map.get("@"), null);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /`@` names no type at all/);
});

test("an )ATTR character declared with a TYPE this reader does not know is named, never invented as one of the three kinds", () => {
  const { map, notes } = parseAttrSection([" @ TYPE(YESNO)"]);
  assert.equal(map.get("@"), null);
  assert.match(notes[0], /names a kind \(YESNO\) this reader does not translate/);
});

test("with no )ATTR section at all, ISPF's own three real built-in defaults apply: % and + protected, a lone _ enterable", () => {
  const panels = parseIspf(`)BODY
%Cust No ===>_ZCUSTNO
+A caption under the low intensity default
)END`);
  assert.equal(panels[0].hadAttrSection, false);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.match(lowered.template, /ng-model="zcustno"/);
  assert.match(lowered.template, /A caption under the low intensity default/);
  assert.doesNotMatch(lowered.template, /ng-model="acaptionunderthelowintensitydefault"/);
  assert.ok(lowered.notes.some((n) => /no \)ATTR section; read with ISPF's own built-in defaults/.test(n)));
});

test("a declared )ATTR default is never overridden by the built-ins: a panel that redefines + as INPUT keeps its own meaning", () => {
  const declared = parseAttrSection([" + TYPE(INPUT)"]).map;
  const effective = effectiveAttrMap(declared);
  assert.equal(effective.get("+"), "INPUT");
  assert.equal(effective.get("%"), "TEXT", "% still falls back to its own default since this panel never mentions it");
});

test("a row of only dashes is a separator, rendered as ordinary caption text with nothing special-cased", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 + TYPE(TEXT)
)BODY
%CUSTOMER MAINTENANCE
+--------------------------------
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.match(lowered.template, /<p>--------------------------------<\/p>/);
});

test("an )INIT and )PROC section's own Dialog Manager statements are named as present once, never read for meaning", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 _ TYPE(INPUT)
)BODY
%CUSTOMER MAINTENANCE
_ZCUSTNO
)INIT
 .ZVARS = '(ZCUSTNO)'
)PROC
 VER (&ZCUSTNO,NB,NUM)
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.equal(lowered.notes.filter((n) => /Dialog Manager logic/.test(n)).length, 1);
  assert.doesNotMatch(lowered.notes.join(" "), /VER \(&|\.ZVARS = /, "the raw statements themselves are never read into a note, only named as present");
});

test("an input attribute character introducing no variable name (only padding) is named rather than guessed", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 _ TYPE(INPUT)
)BODY
%Trailer_
)END`);
  const lowered = lowerIspf(panels[0], "custmaint");
  assert.deepEqual(lowered.fields, []);
  assert.ok(lowered.notes.some((n) => /introduces no variable name/.test(n)));
});

test("multiple )BODY sections in one file become multiple screens", () => {
  const panels = parseIspf(`)ATTR
 % TYPE(TEXT)
 _ TYPE(INPUT)
)BODY
%FIRST PANEL
_ZONE
)END
)BODY
%SECOND PANEL
_ZTWO
)END`);
  assert.equal(panels.length, 2);
  const screens = panels.map((p, i) => lowerIspf(p, "custmaint", i + 1));
  assert.deepEqual(screens.map((s) => s.title), ["FIRST PANEL", "SECOND PANEL"]);
  assert.deepEqual(screens[0].fields, ["zone"]);
  assert.deepEqual(screens[1].fields, ["ztwo"]);
  assert.equal(screens[0].className, "Custmaint");
  assert.equal(screens[1].className, "Custmaint2");
});

test("tokenizeRow splits a row at each declared attribute character, in reading order", () => {
  const attrMap = effectiveAttrMap(parseAttrSection([" % TYPE(TEXT)", " _ TYPE(INPUT)"]).map);
  const runs = tokenizeRow("%Cust No ===>_ZCUSTNO", attrMap);
  assert.deepEqual(runs.map((r) => r.char), ["%", "_"]);
  assert.equal(runs[0].content, "Cust No ===>");
  assert.equal(runs[1].content, "ZCUSTNO");
});

test("an ISPF panel ports to React through the unchanged pipeline, with no raw ISPF syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ispf") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "ispf");
    assert.ok(screen, "the ISPF panel was read");
    assert.deepEqual(screen.outputs, [], "ISPF names no button, event or navigation in a panel body, so no output is ever produced");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /CUSTOMER MAINTENANCE/);
    assert.match(jsx, /Cust No ===>/);
    assert.match(jsx, /Name\s+===>/);
    assert.match(jsx, /onChange=\{\(event\) => setZcustno\(event\.target\.value\)\}/);
    assert.match(jsx, /onChange=\{\(event\) => setZcustnam\(event\.target\.value\)\}/);
    assert.match(jsx, /zstatus/, "the OUTPUT field's variable name survived as a value the port is handed");
    assert.doesNotMatch(
      jsx,
      /\)ATTR|\)BODY|\)PROC|\)INIT|TYPE\(|INTENS\(|===>_|VER \(|\.ZVARS/,
      "no raw ISPF panel syntax or )INIT/)PROC statement survived into the port",
    );

    const md = await readFile(join(run.out, "ISPF.md"), "utf8");
    assert.match(md, /CUSTMAINT\.panel/);
    // )INIT and )PROC are named as present, in English, the way the spec's own example note does; what must
    // never surface is the raw )ATTR/)BODY syntax or the actual statement content inside )INIT/)PROC.
    assert.match(md, /Dialog Manager logic/);
    assert.doesNotMatch(
      md,
      /\)ATTR|\)BODY|TYPE\(|INTENS\(|VER \(&|\.ZVARS = /,
      "no raw )ATTR/)BODY syntax or )INIT/)PROC statement content reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
