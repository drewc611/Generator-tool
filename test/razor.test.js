import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { composeRazor, csharpToJs, lowerRazor } from "../plugins/input-razor/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Razor views composed the way the view engine composes them and lowered
 * onto the dialect, with Model, ViewBag and ViewData as the inputs.
 */

test("C# expressions become the JS they name, outside of strings", () => {
  const notes = [];
  assert.equal(csharpToJs("Model.Tags.Count > 0 && !string.IsNullOrEmpty(Model.Name)", (n) => notes.push(n)), "Model.Tags.length > 0 && !!(Model.Name)");
  assert.equal(csharpToJs("Model.Tags.Any() || Model.Note is null", (n) => notes.push(n)), "Model.Tags.length > 0 || Model.Note == null");
  assert.equal(csharpToJs('x.Name.ToUpper() + " .Count "', (n) => notes.push(n)), 'x.Name.toUpperCase() + " .Count "', "a string is left alone");
  assert.deepEqual(notes, []);
});

test("if with its chain, foreach, switch, explicit and implicit expressions, Raw and DisplayFor lower onto the dialect", () => {
  const notes = [];
  const { template, inputs } = lowerRazor(
    `@if (a) {<b>1</b>} else if (b) {<b>2</b>} else {<b>3</b>}<ul>@foreach (var t in Model.Tags) {<li>@t.Name</li>}</ul>` +
    `@switch (Model.Kind) { case "x": <p>X</p> break; default: <p>O</p> break; }<i>@(Model.Price * 2)</i>@Html.Raw(Model.Html)@Html.DisplayFor(m => m.Sku)<a href="mailto:a@@b">m</a>@:literal line\n<p>@ViewBag.Title</p>`,
    (n) => notes.push(n)
  );
  assert.equal(template,
    `<ng-container ng-if="a"><b>1</b></ng-container><ng-container ng-if="!(a) && (b)"><b>2</b></ng-container><ng-container ng-if="!(a) && !(b)"><b>3</b></ng-container>` +
    `<ul><ng-container ng-repeat="t in Model.Tags"><li>{{ t.Name }}</li></ng-container></ul>` +
    `<ng-container ng-if="(Model.Kind) == 'x'"> <p>X</p> </ng-container><ng-container ng-if="!((Model.Kind) == 'x')"> <p>O</p> </ng-container>` +
    `<i>{{ Model.Price * 2 }}</i><span ng-bind-html="Model.Html"></span>{{ Model.Sku }}<a href="mailto:a@b">m</a>literal line\n<p>{{ ViewBag.Title }}</p>`);
  assert.deepEqual(inputs, ["Model", "ViewBag"]);
  assert.deepEqual(notes, []);
});

test("a view is composed into its layout with the body and sections in place, partials inlined, code blocks named", () => {
  const notes = [];
  const views = new Map([
    ["Views/Shared/_Layout.cshtml", `<html><body>@Html.Partial("_Nav")<main>@RenderBody()</main>@RenderSection("Scripts", required: false)</body></html>`],
    ["Views/Shared/_Nav.cshtml", `<nav>N</nav>`],
  ]);
  const resolve = (name) => { const base = name.replace(/^~\//, "").split("/").pop().replace(/\.cshtml$/, ""); return [...views.entries()].find(([k]) => k.endsWith(`/${base}.cshtml`))?.[1] ?? null; };
  const composed = composeRazor(`@{ Layout = "~/Views/Shared/_Layout.cshtml"; var x = 1; }<h1>@Model.Name</h1>@section Scripts {<script src="a.js"></script>}`, resolve, (n) => notes.push(n));
  assert.equal(composed, `<html><body><nav>N</nav><main><h1>@Model.Name</h1></main><script src="a.js"></script></body></html>`);
  assert.ok(notes.some((n) => /code block/.test(n)));
});

test("a run applies _ViewStart's layout, skips the layout as a screen, reads Model and ViewBag as inputs and ports the view", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/razor") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("shared-layout"), "the layout is chrome, not a screen");
    const show = by("products-show");
    assert.ok(show && show.readBy === "razor");
    assert.match(show.template, /^<nav>/, "the layout's nav partial is composed in and the body is the screen");
    assert.match(show.template, /<ng-container ng-if="User\.Identity\.IsAuthenticated"><span class="who">\{\{ User\.Identity\.Name \}\}<\/span><\/ng-container>/);
    assert.match(show.template, /<ng-container ng-if="Model\.Stock == 0">/);
    assert.match(show.template, /ng-if="!\(Model\.Stock == 0\) && \(Model\.Stock < 5\)"/);
    assert.match(show.template, /<ng-container ng-repeat="tag in Model\.Tags">\s*<li>\{\{ tag\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(show.template, /ng-if="!Model\.Tags\.length > 0"/);
    assert.match(show.template, /\{\{ Model\.Price \* 2 \}\} for two/);
    assert.match(show.template, /ng-if="\(Model\.Type\) == 'shoe'"/);
    assert.match(show.template, /<span ng-bind-html="Model\.DescriptionHtml"><\/span>/);
    assert.match(show.template, /<dt>Sku<\/dt><dd>\{\{ Model\.Sku \}\}<\/dd>/);
    assert.match(show.template, /info@shop\.example/);
    assert.match(show.template, /<script src="\/js\/product\.js">/, "the Scripts section landed where the layout rendered it");
    assert.doesNotMatch(show.template, /@model|@\{|ActionLink|Url\.Action|RenderBody/);
    assert.deepEqual(show.inputs, ["Model", "User", "ViewBag"]);
    assert.ok(by("shared-nav"), "the partial is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|@Model/);
    assert.ok(run.ctx.report.unverified.some((n) => /ActionLink/.test(n)) && run.ctx.report.unverified.some((n) => /Shop\.Models\.Product/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("prose apostrophes, unbalanced brackets, @using lines, email addresses and @: lines are read the way Razor reads them", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(lowerRazor(`@if (Model.Ok) {\n<p>Don't panic</p>\n}\n<p>after</p>`, note).template, `<ng-container ng-if="Model.Ok">\n<p>Don't panic</p>\n</ng-container>\n<p>after</p>`, "an apostrophe in a body is prose, not a C# string");
  const broken = lowerRazor(`<p>@(Model.X</p>`, note);
  assert.equal(broken.template, `<p>@(Model.X</p>`, "an unbalanced expression is kept as text");
  assert.ok(notes.some((n) => /never closes/.test(n)));
  assert.equal(lowerRazor(`@using MyApp.Models\n<h1>T</h1>\n@if (Model.Items.Count > 0) {\n<ul><li>@Model.Name</li></ul>\n}\n<p>tail</p>`, note).template,
    `\n<h1>T</h1>\n<ng-container ng-if="Model.Items.length > 0">\n<ul><li>{{ Model.Name }}</li></ul>\n</ng-container>\n<p>tail</p>`, "a @using directive takes its line and nothing else");
  assert.equal(lowerRazor(`<p>Mail help@example.com now</p>`, note).template, `<p>Mail help@example.com now</p>`, "an email address is the sign itself");
  assert.equal(lowerRazor(`@if (true) {\n@:Hello @Model.Name\n}`, note).template, `<ng-container ng-if="true">\nHello {{ Model.Name }}\n</ng-container>`, "a literal line still evaluates its expressions");
  assert.equal(composeRazor(`@{ Layout = null; var x = new { a = 1 }; }\n<p>body</p>`, null, note), `\n<p>body</p>`, "a code block with nested braces is removed whole");
});
