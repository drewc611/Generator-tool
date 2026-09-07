import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseRptdesign } from "../plugins/input-birt/parse.js";
import { lowerRptdesign } from "../plugins/input-birt/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Eclipse BIRT's `.rptdesign` report definitions, the visually designed
 * report format that ran banking, insurance and government back office
 * reporting alongside JasperReports from the mid 2000s onward. A report is
 * a document layout, not an interactive form, so it becomes a read only
 * screen the way input-jasperreports's reports do: a page-header, body and
 * page-footer section in page order, a table's own header/detail/footer
 * bands as a real HTML table. There is nothing to guess at here except
 * restraint: a bare resultSetColumn reference is read for real, and a
 * computed BIRT expression is named rather than partly reproduced.
 */

function lower(src) {
  const notes = [];
  const lowered = lowerRptdesign(parseRptdesign(src), (n) => notes.push(n));
  lowered.notes = notes;
  return lowered;
}

test("page-header, body and page-footer sections lower onto the dialect, with a table's header/detail/footer bands as a real table and a bare resultSetColumn reference read", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <report xmlns="http://www.eclipse.org/birt/2005/design" version="3.2.23">
    <property name="title">InvoiceReport</property>
    <parameters>
      <scalar-parameter name="CompanyName" id="12">
        <property name="dataType">string</property>
      </scalar-parameter>
    </parameters>
    <data-sets>
      <oda-data-set name="CustomerDataSet" id="20">
        <list-property name="resultSetColumn">
          <structure><property name="name">customerName</property><property name="dataType">string</property></structure>
          <structure><property name="name">amount</property><property name="dataType">decimal</property></structure>
        </list-property>
      </oda-data-set>
    </data-sets>
    <page-header>
      <text-item id="30"><property name="content">Invoice</property></text-item>
    </page-header>
    <body>
      <table id="40" name="detailsTable">
        <list-property name="dataSet">CustomerDataSet</list-property>
        <header>
          <row id="41">
            <cell id="42"><label id="43"><text-property name="text">Customer</text-property></label></cell>
            <cell id="44"><label id="45"><text-property name="text">Amount</text-property></label></cell>
          </row>
        </header>
        <detail>
          <row id="50">
            <cell id="51"><data id="52"><property name="resultSetColumn">customerName</property></data></cell>
            <cell id="53"><data id="54"><property name="resultSetColumn">amount</property></data></cell>
          </row>
        </detail>
      </table>
    </body>
    <page-footer>
      <text-item id="70"><property name="content">Page footer</property></text-item>
    </page-footer>
  </report>`;

  const lowered = lower(src);
  assert.equal(lowered.className, "InvoiceReport");
  assert.deepEqual(lowered.sectionsRendered, ["page-header", "body", "page-footer"]);
  assert.deepEqual(lowered.parameters, [{ name: "CompanyName", dataType: "string" }]);
  assert.deepEqual(lowered.dataSets, [{
    name: "CustomerDataSet",
    columns: [
      { name: "customerName", dataType: "string" },
      { name: "amount", dataType: "decimal" },
    ],
  }]);
  assert.match(lowered.template, /<section aria-label="page header">\s*<p>Invoice<\/p>\s*<\/section>/);
  assert.match(lowered.template, /<section aria-label="page footer">\s*<p>Page footer<\/p>\s*<\/section>/);
  assert.match(lowered.template, /<thead><tr><td><p>Customer<\/p><\/td><td><p>Amount<\/p><\/td><\/tr><\/thead>/);
  assert.match(lowered.template, /<tbody><tr><td><p>\{\{ customerName \}\}<\/p><\/td><td><p>\{\{ amount \}\}<\/p><\/td><\/tr><\/tbody>/, "a bare resultSetColumn reference becomes dialect interpolation");
  assert.deepEqual(lowered.notes, []);
});

test("a data element carrying a computed expression is named as unevaluated and renders an empty placeholder, never leaking the expression", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <property name="title">WithTotal</property>
    <body>
      <table name="detailsTable">
        <list-property name="dataSet">CustomerDataSet</list-property>
        <footer>
          <row>
            <cell><label><text-property name="text">Total</text-property></label></cell>
            <cell><data><expression name="value">Total.sum(dataSetRow["amount"])</expression></data></cell>
          </row>
        </footer>
      </table>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.match(lowered.template, /<tfoot><tr><td><p>Total<\/p><\/td><td><p><\/p><\/td><\/tr><\/tfoot>/);
  assert.ok(lowered.notes.some((n) => /a data element's value is a computed BIRT expression/.test(n)));
  const joined = lowered.notes.join("\n") + lowered.template;
  assert.doesNotMatch(joined, /Total\.sum|dataSetRow|amount"/i, "no part of an unevaluated expression leaks into the template or the notes");
});

test("a data element with both a resultSetColumn and an expression is treated as computed, since the expression is what BIRT actually evaluates", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <body>
      <table name="t">
        <detail>
          <row>
            <cell><data><property name="resultSetColumn">amount</property><expression name="value">amount * 1.1</expression></data></cell>
          </row>
        </detail>
      </table>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.doesNotMatch(lowered.template, /\{\{\s*amount\s*\}\}/, "the expression wins over the plain resultSetColumn, not the bare reference");
  assert.ok(lowered.notes.some((n) => /computed BIRT expression/.test(n)));
  assert.doesNotMatch(lowered.notes.join("\n"), /amount \* 1\.1/);
});

test("a list is named as present with its bound dataset, never inlined", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <body>
      <list name="RecentActivity">
        <list-property name="dataSet">CustomerDataSet</list-property>
      </list>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the list `RecentActivity` is a repeating list container bound to the dataset `CustomerDataSet`/.test(n)));
  assert.doesNotMatch(lowered.template, /RecentActivity|CustomerDataSet/, "nothing from the list's own content is inlined");
});

test("an image is named, its source never evaluated, and nothing is rendered in its place", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <body>
      <image id="80"><property name="source">logo.png</property></image>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the body section's an image names a source this reader does not evaluate/.test(n)));
  assert.doesNotMatch(lowered.template, /logo\.png|<image/i);
});

test("an element with no vocabulary entry is named, never approximated", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <body>
      <chart id="90"/>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the `chart` element in the body section has no vocabulary entry in this reader/.test(n)));
  assert.doesNotMatch(lowered.template, /<div|<p|<table/, "an unrecognised element renders nothing rather than a guess");
});

test("a grid is a layout only table with no dataset, its rows read the same way a table's are", () => {
  const src = `<report xmlns="http://www.eclipse.org/birt/2005/design">
    <body>
      <grid name="layoutGrid">
        <row>
          <cell><label><text-property name="text">Left</text-property></label></cell>
          <cell><label><text-property name="text">Right</text-property></label></cell>
        </row>
      </grid>
    </body>
  </report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the grid `layoutGrid` is a layout only table with no dataset/.test(n)));
  assert.match(lowered.template, /<table><tr><td><p>Left<\/p><\/td><td><p>Right<\/p><\/td><\/tr><\/table>/);
});

test("a CustomerInvoiceReport .rptdesign ports to React through the unchanged pipeline, with no rptdesign or BIRT expression syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/birt") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "birt");
    assert.ok(screen, "the BIRT report was read");
    assert.deepEqual(screen.outputs, [], "a report has no events to wire");

    const jsx = await readFile(join(run.out, "src/features/CustomerInvoiceReport/CustomerInvoiceReport.jsx"), "utf8");
    assert.match(jsx, /\{customerName\}/);
    assert.match(jsx, /\{amount\}/);
    assert.match(jsx, /Invoice/);
    assert.match(jsx, /Page footer/);

    const birtMd = await readFile(join(run.out, "BIRT.md"), "utf8");
    assert.match(birtMd, /CustomerInvoiceReport/);
    assert.match(birtMd, /CompanyName \(string\)/);
    assert.match(birtMd, /customerName \(string\)/);
    assert.match(birtMd, /invoiceDate \(date\)/);
    assert.match(birtMd, /amount \(decimal\)/);
    assert.match(birtMd, /page-header, body, page-footer/);
    assert.ok(run.ctx.report.unverified.some((n) => /a data element's value is a computed BIRT expression/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /the list `RecentActivity` is a repeating list container bound to the dataset `CustomerDataSet`/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /an image names a source this reader does not evaluate/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /the `chart` element in the body section has no vocabulary entry/.test(n)));

    // Nothing this reader refuses to evaluate, and no raw rptdesign vocabulary, ever reaches the port.
    const FORBIDDEN = /resultSetColumn|dataSetRow|<data-set|<expression|Total\.sum/;
    assert.doesNotMatch(jsx, FORBIDDEN);
    assert.doesNotMatch(birtMd, FORBIDDEN);
    for (const n of run.ctx.report.unverified) assert.doesNotMatch(n, FORBIDDEN);
  } finally {
    await run.cleanup();
  }
});
