import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseRdl } from "../plugins/input-ssrs/parse.js";
import { lowerRdl } from "../plugins/input-ssrs/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Microsoft SQL Server Reporting Services' `.rdl` report definitions, the
 * dominant Microsoft enterprise reporting format since SQL Server 2000,
 * still enormous in banking, insurance and government back offices. A
 * report is a document layout, not an interactive form, so it becomes a
 * read only screen the way input-jasperreports's and input-birt's reports
 * do, PageHeader/Body/PageFooter each a section in page order, a Tablix's
 * deep row/cell nesting flattened onto a real HTML table. There is nothing
 * to guess at here except restraint: a bare Fields! or Parameters! reference
 * is read for real, and anything a Textbox's value does beyond that is
 * named rather than partly reproduced.
 */

function lower(src, name = "Report") {
  const notes = [];
  const lowered = lowerRdl(parseRdl(src), name, (n) => notes.push(n));
  lowered.notes = notes;
  return lowered;
}

test("PageHeader, Body and PageFooter sections lower onto the dialect, with a Tablix's rows and cells as a real table and both bare reference shapes read", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
    <ReportParameters>
      <ReportParameter Name="CompanyName">
        <DataType>String</DataType>
      </ReportParameter>
    </ReportParameters>
    <DataSets>
      <DataSet Name="CustomerDataSet">
        <Fields>
          <Field Name="customerName"><DataField>customerName</DataField><rd:TypeName>System.String</rd:TypeName></Field>
          <Field Name="amount"><DataField>amount</DataField><rd:TypeName>System.Decimal</rd:TypeName></Field>
        </Fields>
      </DataSet>
    </DataSets>
    <PageHeader>
      <ReportItems>
        <Textbox Name="pageHeaderTb"><Value>=Parameters!CompanyName.Value</Value></Textbox>
      </ReportItems>
    </PageHeader>
    <Body>
      <ReportItems>
        <Tablix Name="detailsTablix">
          <DataSetName>CustomerDataSet</DataSetName>
          <TablixBody>
            <TablixRows>
              <TablixRow>
                <TablixCells>
                  <TablixCell><CellContents><Textbox Name="tb1"><Value>Customer</Value></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="tb2"><Value>Amount</Value></Textbox></CellContents></TablixCell>
                </TablixCells>
              </TablixRow>
              <TablixRow>
                <TablixCells>
                  <TablixCell><CellContents><Textbox Name="tb3"><Value>=Fields!customerName.Value</Value></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="tb4"><Value>=Fields!amount.Value</Value></Textbox></CellContents></TablixCell>
                </TablixCells>
              </TablixRow>
            </TablixRows>
          </TablixBody>
        </Tablix>
      </ReportItems>
    </Body>
    <PageFooter>
      <ReportItems>
        <Textbox Name="pageFooterTb"><Value>Confidential</Value></Textbox>
      </ReportItems>
    </PageFooter>
  </Report>`;

  const lowered = lower(src, "InvoiceReport");
  assert.equal(lowered.className, "InvoiceReport");
  assert.deepEqual(lowered.sectionsRendered, ["PageHeader", "Body", "PageFooter"]);
  assert.deepEqual(lowered.parameters, [{ name: "CompanyName", dataType: "String" }]);
  assert.deepEqual(lowered.dataSets, [{
    name: "CustomerDataSet",
    fields: [
      { name: "customerName", typeName: "System.String" },
      { name: "amount", typeName: "System.Decimal" },
    ],
  }]);
  assert.match(lowered.template, /<section aria-label="page header">\s*<p>\{\{ CompanyName \}\}<\/p>\s*<\/section>/, "a bare Parameters! reference becomes dialect interpolation");
  assert.match(lowered.template, /<section aria-label="page footer">\s*<p>Confidential<\/p>\s*<\/section>/);
  assert.match(lowered.template, /<table><tbody><tr><td><p>Customer<\/p><\/td><td><p>Amount<\/p><\/td><\/tr><tr><td><p>\{\{ customerName \}\}<\/p><\/td><td><p>\{\{ amount \}\}<\/p><\/td><\/tr><\/tbody><\/table>/, "a bare Fields! reference becomes dialect interpolation, and the Tablix's rows and cells become a real table with no header/footer split");
  assert.ok(lowered.notes.some((n) => /the tablix `detailsTablix` is fed by the dataset `CustomerDataSet`/.test(n)));
});

test("a textbox's computed RDL expression is named as unevaluated and renders an empty placeholder", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Textbox Name="totalTb"><Value>=Sum(Fields!amount.Value)</Value></Textbox>
        <Textbox Name="condTb"><Value>=IIf(Fields!amount.Value &gt; 100, "High", "Low")</Value></Textbox>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.match(lowered.template, /<section aria-label="body">\s*<p><\/p>\s*<p><\/p>\s*<\/section>/);
  assert.equal(lowered.notes.length, 2);
  for (const n of lowered.notes) assert.match(n, /a textbox in the body section carries a computed RDL expression/);
  const joined = lowered.notes.join("\n") + lowered.template;
  assert.doesNotMatch(joined, /Sum\(|IIf\(|Fields!|amount|High|Low/, "no part of an unevaluated expression leaks into the template or the notes");
});

test("a tablix names which dataset feeds it", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Tablix Name="salesTablix">
          <DataSetName>SalesDataSet</DataSetName>
          <TablixBody><TablixRows></TablixRows></TablixBody>
        </Tablix>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the tablix `salesTablix` is fed by the dataset `SalesDataSet`/.test(n)));
});

test("a tablix with no DataSetName is named as feeding nothing", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Tablix Name="noDataTablix">
          <TablixBody><TablixRows></TablixRows></TablixBody>
        </Tablix>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the tablix `noDataTablix` declares no DataSetName; nothing feeds it/.test(n)));
});

test("a subreport is named as a nested report this reader does not follow, never inlined", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Subreport Name="lineItemsSubreport"><ReportName>LineItems</ReportName></Subreport>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /a subreport in the body section names `LineItems` as a nested report this reader does not follow/.test(n)));
  assert.doesNotMatch(lowered.template, /LineItems|<Subreport|ReportName/i, "nothing from the subreport is inlined");
});

test("an image is named, its source never evaluated, and nothing is rendered in its place", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Image Name="logoImage"><Source>Embedded</Source><Value>logoBytes</Value></Image>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /an image in the body section names a source this reader does not evaluate/.test(n)));
  assert.doesNotMatch(lowered.template, /logoBytes|Embedded|<Image/i);
});

test("a Line and a Rectangle lower onto an hr and a boxed div", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Line Name="rule1"/>
        <Rectangle Name="box1"><ReportItems/></Rectangle>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.match(lowered.template, /<section aria-label="body">\s*<hr>\s*<div class="box"><\/div>\s*<\/section>/);
  assert.deepEqual(lowered.notes, []);
});

test("an element with no vocabulary entry is named, never approximated", () => {
  const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
    <Body>
      <ReportItems>
        <Chart Name="salesChart"/>
      </ReportItems>
    </Body>
  </Report>`;
  const lowered = lower(src);
  assert.ok(lowered.notes.some((n) => /the `chart` element in the body section has no vocabulary entry in this reader/.test(n)));
  assert.doesNotMatch(lowered.template, /<div|<p|<table|<hr/, "an unrecognised element renders nothing rather than a guess");
});

test("an InvoiceReport .rdl ports to React through the unchanged pipeline, with no RDL or VB.NET expression syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ssrs") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "ssrs");
    assert.ok(screen, "the SSRS report was read");
    assert.deepEqual(screen.outputs, [], "a report has no events to wire");

    const jsx = await readFile(join(run.out, "src/features/InvoiceReport/InvoiceReport.jsx"), "utf8");
    assert.match(jsx, /function InvoiceReport\(\{[^}]*\bCompanyName\b[^}]*\}\)/, "the report parameter reads as a prop");
    assert.match(jsx, /\{customerName\}/);
    assert.match(jsx, /\{amount\}/);
    assert.match(jsx, /Invoice Report/);
    assert.match(jsx, /Confidential/);

    const ssrsMd = await readFile(join(run.out, "SSRS.md"), "utf8");
    assert.match(ssrsMd, /InvoiceReport/);
    assert.match(ssrsMd, /CompanyName \(String\)/);
    assert.match(ssrsMd, /customerName \(System\.String\)/);
    assert.match(ssrsMd, /invoiceDate \(System\.DateTime\)/);
    assert.match(ssrsMd, /amount \(System\.Decimal\)/);
    assert.match(ssrsMd, /PageHeader, Body, PageFooter/);
    assert.ok(run.ctx.report.unverified.some((n) => /a textbox in the body section carries a computed RDL expression/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /a subreport in the body section names `LineItems` as a nested report this reader does not follow/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /an image in the body section names a source this reader does not evaluate/.test(n)));
    assert.ok(run.ctx.report.unverified.some((n) => /the tablix `detailsTablix` is fed by the dataset `CustomerDataSet`/.test(n)));

    // Nothing this reader refuses to evaluate, and no raw RDL or VB.NET expression syntax, ever reaches the port.
    const FORBIDDEN = /Fields!|Parameters!|<Tablix|<TablixRow|<ReportParameter|Sum\(/;
    assert.doesNotMatch(jsx, FORBIDDEN);
    assert.doesNotMatch(ssrsMd, FORBIDDEN);
    for (const n of run.ctx.report.unverified) assert.doesNotMatch(n, FORBIDDEN);
  } finally {
    await run.cleanup();
  }
});
