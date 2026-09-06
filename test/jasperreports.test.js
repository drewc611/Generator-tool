import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseJrxml } from "../plugins/input-jasperreports/parse.js";
import { lowerJrxml } from "../plugins/input-jasperreports/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * JasperReports' `.jrxml` report definitions, the band layout format that
 * designed the Java enterprise back office's invoices, statements and
 * printed reports from the mid 2000s onward. A report is a document layout,
 * not an interactive form, so it becomes a read only screen the way
 * input-pdf's documents do, one section per band in the order the page
 * prints them. There is nothing to guess at here except restraint: a bare
 * $F/$P/$V reference is read for real, and anything a textField expression
 * does beyond that is named rather than partly reproduced.
 */

function lower(src) {
  const notes = [];
  const lowered = lowerJrxml(parseJrxml(src), (n) => notes.push(n));
  lowered.notes = notes;
  return lowered;
}

test("title, column header, detail and summary bands lower onto the dialect, with $F, $P and $V each read as a bare reference", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <jasperReport name="InvoiceReport">
    <parameter name="CompanyName" class="java.lang.String"/>
    <field name="customerName" class="java.lang.String"/>
    <field name="invoiceDate" class="java.util.Date"/>
    <field name="amount" class="java.math.BigDecimal"/>
    <title>
      <band height="60">
        <staticText>
          <reportElement x="0" y="0" width="200" height="30"/>
          <text><![CDATA[Invoice]]></text>
        </staticText>
        <textField>
          <reportElement x="0" y="30" width="200" height="20"/>
          <textFieldExpression><![CDATA[$P{CompanyName}]]></textFieldExpression>
        </textField>
      </band>
    </title>
    <columnHeader>
      <band height="20">
        <staticText>
          <reportElement x="0" y="0" width="100" height="20"/>
          <text><![CDATA[Customer]]></text>
        </staticText>
        <staticText>
          <reportElement x="100" y="0" width="100" height="20"/>
          <text><![CDATA[Amount]]></text>
        </staticText>
      </band>
    </columnHeader>
    <detail>
      <band height="20">
        <textField>
          <reportElement x="0" y="0" width="100" height="20"/>
          <textFieldExpression><![CDATA[$F{customerName}]]></textFieldExpression>
        </textField>
        <textField pattern="#,##0.00">
          <reportElement x="100" y="0" width="100" height="20"/>
          <textFieldExpression><![CDATA[$F{amount}]]></textFieldExpression>
        </textField>
      </band>
    </detail>
    <summary>
      <band height="30">
        <textField>
          <reportElement x="0" y="0" width="100" height="20"/>
          <textFieldExpression><![CDATA[$V{amount_SUM}]]></textFieldExpression>
        </textField>
      </band>
    </summary>
  </jasperReport>`;

  const lowered = lower(src);
  assert.equal(lowered.className, "InvoiceReport");
  assert.deepEqual(lowered.bandsRendered, ["title", "columnHeader", "detail", "summary"]);
  assert.deepEqual(lowered.parameters, [{ name: "CompanyName", class: "java.lang.String" }]);
  assert.deepEqual(lowered.fields, [
    { name: "customerName", class: "java.lang.String" },
    { name: "invoiceDate", class: "java.util.Date" },
    { name: "amount", class: "java.math.BigDecimal" },
  ]);
  assert.match(lowered.template, /<section aria-label="title">\s*<p>Invoice<\/p>\s*<p>\{\{ CompanyName \}\}<\/p>/);
  assert.match(lowered.template, /<section aria-label="column header">\s*<p>Customer<\/p>\s*<p>Amount<\/p>/);
  assert.match(lowered.template, /<p>\{\{ customerName \}\}<\/p>/, "a bare $F{} reference becomes dialect interpolation");
  assert.match(lowered.template, /<p>\{\{ amount \}\}<\/p>/, "a textField's own pattern attribute changes nothing about the reference read");
  assert.match(lowered.template, /<p>\{\{ amount_SUM \}\}<\/p>/, "a bare $V{} reference becomes dialect interpolation the same way");
  assert.deepEqual(lowered.notes, []);
});

test("a textField expression that is more than a bare reference is named as unevaluated and renders an empty placeholder", () => {
  const src = `<jasperReport name="Complex">
    <field name="invoiceDate" class="java.util.Date"/>
    <detail>
      <band height="20">
        <textField>
          <reportElement x="0" y="0" width="100" height="20"/>
          <textFieldExpression><![CDATA[new java.text.SimpleDateFormat("MM/dd/yyyy").format($F{invoiceDate})]]></textFieldExpression>
        </textField>
        <textField>
          <reportElement x="0" y="20" width="100" height="20"/>
          <textFieldExpression><![CDATA["Customer: " + $F{invoiceDate}]]></textFieldExpression>
        </textField>
      </band>
    </detail>
  </jasperReport>`;
  const lowered = lower(src);
  assert.match(lowered.template, /<section aria-label="detail">\s*<p><\/p>\s*<p><\/p>\s*<\/section>/);
  assert.equal(lowered.notes.length, 2);
  for (const n of lowered.notes) assert.match(n, /detail band's textField expression is more than a bare field, parameter or variable reference/);
  const joined = lowered.notes.join("\n") + lowered.template;
  assert.doesNotMatch(joined, /SimpleDateFormat|invoiceDate|\$F\{|Customer:/, "no part of an unevaluated expression leaks into the template or the notes");
});

test("a subreport is named as a nested report this reader does not follow, never inlined", () => {
  const src = `<jasperReport name="WithSub">
    <detail>
      <band height="20">
        <subreport>
          <reportElement x="0" y="0" width="200" height="20"/>
          <subreportExpression><![CDATA["lineitems.jasper"]]></subreportExpression>
        </subreport>
      </band>
    </detail>
  </jasperReport>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /a subreport in the detail band is a nested report this reader does not follow/.test(n)));
  assert.doesNotMatch(lowered.template, /lineitems|subreportExpression|<subreport/i, "nothing from the subreport is inlined");
});

test("an image is named, its source expression never evaluated, and nothing is rendered in its place", () => {
  const src = `<jasperReport name="WithImage">
    <title>
      <band height="20">
        <image>
          <reportElement x="0" y="0" width="20" height="20"/>
          <imageExpression><![CDATA["logo.png"]]></imageExpression>
        </image>
      </band>
    </title>
  </jasperReport>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /an image in the title band names a source expression this reader does not evaluate/.test(n)));
  assert.doesNotMatch(lowered.template, /logo\.png|imageExpression|<image/i);
});

test("an element in a band with no vocabulary entry is named, never approximated", () => {
  const src = `<jasperReport name="WithFrame">
    <detail>
      <band height="20">
        <frame>
          <reportElement x="0" y="0" width="200" height="20"/>
        </frame>
      </band>
    </detail>
  </jasperReport>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the `frame` element in the detail band has no vocabulary entry in this reader/.test(n)));
  assert.doesNotMatch(lowered.template, /<div|<p|<hr/, "an unrecognised element renders nothing rather than a guess");
});

test("an InvoiceReport .jrxml ports to React through the unchanged pipeline, with no JRXML or Java expression syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/jasperreports") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "jasperreports");
    assert.ok(screen, "the JasperReports report was read");
    assert.deepEqual(screen.outputs, [], "a report has no events to wire");

    const jsx = await readFile(join(run.out, "src/features/InvoiceReport/InvoiceReport.jsx"), "utf8");
    assert.match(jsx, /function InvoiceReport\(\{[^}]*\bCompanyName\b[^}]*\}\)/, "the report parameter reads as a prop");
    assert.match(jsx, /\{customerName\}/);
    assert.match(jsx, /\{amount\}/);
    assert.match(jsx, /\{amount_SUM\}/, "a report variable reads the same honest way a field does");
    assert.match(jsx, /\{CompanyName\}/);

    const jasperMd = await readFile(join(run.out, "JASPERREPORTS.md"), "utf8");
    assert.match(jasperMd, /InvoiceReport/);
    assert.match(jasperMd, /CompanyName \(java\.lang\.String\)/);
    assert.match(jasperMd, /customerName \(java\.lang\.String\)/);
    assert.match(jasperMd, /invoiceDate \(java\.util\.Date\)/);
    assert.match(jasperMd, /amount \(java\.math\.BigDecimal\)/);
    assert.match(jasperMd, /title, columnHeader, detail, summary/);
    assert.ok(run.ctx.report.unverified.some((n) => /textField expression is more than a bare field, parameter or variable reference/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /a subreport in the detail band is a nested report this reader does not follow/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /an image in the detail band names a source expression this reader does not evaluate/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /the `frame` element in the detail band has no vocabulary entry/.test(n)));

    // Nothing this reader refuses to evaluate ever reaches the port, in the component, its notes, or the report.
    const FORBIDDEN = /\$F\{|\$P\{|\$V\{|SimpleDateFormat|<textField|<reportElement/;
    assert.doesNotMatch(jsx, FORBIDDEN);
    assert.doesNotMatch(jasperMd, FORBIDDEN);
    for (const n of run.ctx.report.unverified) assert.doesNotMatch(n, FORBIDDEN);
  } finally {
    await run.cleanup();
  }
});
