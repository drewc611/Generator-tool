import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseAwt, isGenerated, literalString } from "../plugins/input-awt/parse.js";
import { lowerAwt } from "../plugins/input-awt/lower.js";
import { isGenerated as swingIsGenerated } from "../plugins/input-swing/parse.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Raw Java AWT/Swing UI construction: a screen built entirely by ordinary
 * `new ClassName(...)` and `add(...)` statements, with no separate
 * declarative designer file and no builder-generated initComponents at all,
 * the same "screen built one statement in source" pattern input-autoit's
 * own GUICreate/GUICtrlCreate* calls already establish. A whole `.java`
 * file is one screen; a field's own name comes from the variable its
 * construction was assigned to, since a constructor call is itself the
 * value, unlike AutoIt's own functions which return one. A file already
 * bracketed by input-swing's own GEN-BEGIN/GEN-END or editor-fold markers
 * was written by a GUI builder, not by hand, and is left entirely to
 * input-swing.
 */

test("input-awt's GEN-marker check is the identical function input-swing exports, never a paraphrase of it", () => {
  assert.equal(isGenerated, swingIsGenerated, "imported, not reimplemented");
});

test("a plain literal label renders a caption with no input", () => {
  const read = parseAwt('JLabel custNoLabel = new JLabel("Cust No:");\nadd(custNoLabel);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("a label constructed from a non-literal argument is a real gap, named rather than guessed", () => {
  const read = parseAwt('JLabel custNameLabel = new JLabel(nameCaption);\nadd(custNameLabel);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.doesNotMatch(lowered.template, /<p>/);
  assert.ok(lowered.notes.some((n) => /text argument is not a plain string literal/.test(n)));
});

test("a text field assigned to a variable takes its field name from that variable", () => {
  const read = parseAwt("custNoField = new JTextField(10);\nadd(custNoField);");
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<input id="f-custNoField" type="text" ng-model="custNoField">/);
  assert.deepEqual(lowered.fields, ["custNoField"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a text field never assigned to a variable at all is a real gap, named rather than invented", () => {
  const read = parseAwt("add(new JTextField(5));");
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
  assert.ok(lowered.notes.some((n) => /never assigned to a variable/.test(n)));
});

test("AWT's own class names (Label, TextField) are read as the same kind as their Swing J-prefixed spelling", () => {
  const read = parseAwt('Label oldLabel = new Label("Old style");\nadd(oldLabel);\nnameField = new TextField(20);\nadd(nameField);');
  const lowered = lowerAwt(read, "OldPanel");
  assert.match(lowered.template, /<p>Old style<\/p>/);
  assert.match(lowered.template, /ng-model="nameField"/);
});

test("a checkbox binds ng-model to its own assigned variable and pairs its own literal caption", () => {
  const read = parseAwt('activeCheck = new JCheckBox("Active");\nadd(activeCheck);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="activeCheck"> Active<\/label>/);
});

test("a JComboBox/Choice is named present; its inline options are never invented", () => {
  const read = parseAwt('JComboBox regionChoice = new JComboBox();\nregionChoice.addItem("East");\nregionChoice.addItem("West");\nadd(regionChoice);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.doesNotMatch(lowered.template, /East|West|<select/);
  assert.ok(lowered.notes.some((n) => /JComboBox is constructed.*options.*not read/.test(n)));
});

test("a button wired to a single bare method call lambda resolves that call as its output", () => {
  const read = parseAwt('JButton okButton = new JButton("OK");\nokButton.addActionListener(e -> handleOk());\nadd(okButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
});

test("the equivalent block-bodied lambda with one bare call also resolves, since it is the same clean wiring", () => {
  const read = parseAwt('JButton okButton = new JButton("OK");\nokButton.addActionListener(e -> { handleOk(); });\nadd(okButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /ng-click="onHandleOk\(\)"/);
});

test("a multi-statement lambda body is named as wired to something not read, never approximated", () => {
  const read = parseAwt('JButton applyButton = new JButton("Apply");\napplyButton.addActionListener(e -> {\n    handleApply();\n    refresh();\n});\nadd(applyButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<button type="button">Apply<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /not a single bare method call lambda/.test(n)));
});

test("an anonymous ActionListener inner class is named as wired to something not read, never approximated", () => {
  const read = parseAwt('JButton weirdButton = new JButton("Weird");\nweirdButton.addActionListener(new ActionListener() {\n    public void actionPerformed(ActionEvent e) { handleOk(); }\n});\nadd(weirdButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /not a single bare method call lambda/.test(n)));
});

test("a button with no addActionListener call at all is named as unwired", () => {
  const read = parseAwt('JButton cancelButton = new JButton("Cancel");\nadd(cancelButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /no addActionListener call referencing its own variable/.test(n)));
});

test("a button's caption comes from a same-variable setText call when its own constructor carries none", () => {
  const read = parseAwt('JButton saveButton = new JButton();\nsaveButton.setText("Save");\nsaveButton.addActionListener(e -> handleOk());\nadd(saveButton);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, />Save<\/button>/);
});

test("an unrecognised construction is named, never approximated", () => {
  const read = parseAwt("progressBar = new JProgressBar();\nadd(progressBar);");
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.equal(lowered.template, "<div>\n</div>");
  assert.ok(lowered.notes.some((n) => /JProgressBar.*not a recognised control construction/.test(n)));
});

test("a container or layout construction (JPanel, BorderLayout) is skipped with no note at all", () => {
  const read = parseAwt('JPanel inner = new JPanel(new BorderLayout());\nadd(inner);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.deepEqual(lowered.notes, []);
});

test("controls render in the order their own construction statement appears, not the order add() reaches them", () => {
  const read = parseAwt([
    'custNoField = new JTextField(10);',
    'JLabel custNoLabel = new JLabel("Cust No:");',
    "add(custNoLabel);", // add() called out of construction order on purpose
    "add(custNoField);",
  ].join("\n"));
  const lowered = lowerAwt(read, "CustomerPanel");
  const idxInput = lowered.template.indexOf("<input");
  const idxLabel = lowered.template.indexOf("<p>Cust No:</p>");
  assert.ok(idxInput < idxLabel, "the field constructed first renders first, regardless of add() order");
});

test("a Java string literal with an escaped quote decodes correctly and does not end the literal early", () => {
  assert.equal(literalString('"She said \\"hi\\""'), 'She said "hi"');
  const read = parseAwt('JLabel greeting = new JLabel("She said \\"hi\\"");\nadd(greeting);');
  const lowered = lowerAwt(read, "CustomerPanel");
  assert.match(lowered.template, /She said &quot;hi&quot;/);
});

test("a GEN-marked file is not this reader's vocabulary at the parse level either: isGenerated is true for it", () => {
  const generated = [
    "public class GeneratedForm extends javax.swing.JFrame {",
    '    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents',
    "    private void initComponents() {",
    "        greetingLabel = new javax.swing.JLabel();",
    "    }//GEN-END:initComponents",
    "    // </editor-fold>",
    "}",
  ].join("\n");
  assert.equal(isGenerated(generated), true);
});

test("a full customer panel ports to React through the unchanged pipeline, with no raw Java syntax leaking, and the GEN-marked file in the same folder is left entirely to input-swing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/awt") });
  try {
    assert.equal(run.error, null);
    const awtScreens = run.ctx.screens.filter((s) => s.readBy === "awt");
    assert.equal(awtScreens.length, 1, "a whole hand written .java file is one screen; the GEN-marked file produced none");

    const screen = awtScreens[0];
    assert.equal(screen.title, "CustomerPanel");
    assert.ok(screen.outputs.includes("handleOk"), "the OK button's clean lambda resolved to a real output");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Active/);
    assert.match(jsx, /onClick=\{\(\) => onHandleOk\(\)\}/);
    assert.doesNotMatch(
      jsx,
      /new JLabel|new JTextField|new JButton|addActionListener|JComboBox|handleApply\(\)|refresh\(\)|custNoField =/,
      "no raw Java construction syntax, method bodies or field assignment text survived into the port",
    );

    const md = await readFile(join(run.out, "AWT.md"), "utf8");
    assert.match(md, /CustomerPanel\.java/);
    assert.match(md, /CustomerPanel/);
    assert.match(md, /never assigned to a variable/);
    assert.match(md, /not a single bare method call lambda/);
    assert.match(md, /options.*not read/);
    assert.doesNotMatch(md, /GeneratedForm/, "the GEN-marked file is left entirely to input-swing and never appears in AWT.md");
    assert.doesNotMatch(
      md,
      /new JLabel\(|addActionListener\(e ->|handleApply\(\)|refresh\(\)/,
      "no raw Java statement syntax reaches the report",
    );

    // input-swing still reads the GEN-marked file in the same folder: proof the two readers
    // partition the same extension rather than either one swallowing the other's file.
    const swingScreens = run.ctx.screens.filter((s) => s.readBy === "swing");
    assert.equal(swingScreens.length, 1, "input-swing reads the GEN-marked file this run left to it");
  } finally {
    await run.cleanup();
  }
});
