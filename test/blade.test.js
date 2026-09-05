import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { composeBlade, lowerBlade, phpToJs } from "../plugins/input-blade/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Blade views composed the way the compiler composes them and lowered onto
 * the dialect, with the variables a view reads as its inputs.
 */

test("PHP expressions become the JS they name, outside of strings", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(phpToJs("$product->name", note), "product.name");
  assert.equal(phpToJs("!empty($tags) && count($tags) > 2", note), "!!(tags) && tags.length > 2");
  assert.equal(phpToJs("isset($x) and $x->y === 'a -> b'", note), "(x != null) && x.y === 'a -> b'");
  assert.equal(phpToJs("$loop->iteration . ': ' . strtoupper($t)", note), "($index + 1) + ': ' + t.toUpperCase()");
  assert.equal(phpToJs("User::count()", note), "User.count()");
  assert.deepEqual(notes, []);
  phpToJs("route('home')", note);
  assert.ok(notes.some((n) => /Laravel helper/.test(n)));
});

test("if, elseif, unless, isset, forelse with empty, switch, auth, can and error lower onto the dialect's blocks", () => {
  const notes = [];
  const { template, variables } = lowerBlade(
    `@if($a)1@elseif($b)2@else 3@endif@unless($c)4@endunless@isset($d)5@endisset` +
    `<ul>@forelse($items as $i)<li>{{ $i->name }}</li>@empty<li>none</li>@endforelse</ul>` +
    `@switch($t)@case('x')X@break@default O@endswitch@auth A@endauth@guest G@endguest@can('edit', $p)E@endcan@error('name')<b>{{ $message }}</b>@enderror{!! $html !!}`,
    (n) => notes.push(n)
  );
  assert.equal(template,
    `<ng-container ng-if="a">1</ng-container><ng-container ng-if="!(a) && (b)">2</ng-container><ng-container ng-if="!(a) && !(b)"> 3</ng-container>` +
    `<ng-container ng-if="!(c)">4</ng-container><ng-container ng-if="(d != null)">5</ng-container>` +
    `<ul><ng-container ng-repeat="i in items"><li>{{ i.name }}</li></ng-container><ng-container ng-if="!items || !items.length"><li>none</li></ng-container></ul>` +
    `<ng-container ng-if="(t) == 'x'">X</ng-container><ng-container ng-if="!((t) == 'x')"> O</ng-container>` +
    `<ng-container ng-if="auth"> A</ng-container><ng-container ng-if="!auth"> G</ng-container><ng-container ng-if="can('edit', p)">E</ng-container>` +
    `<ng-container ng-if="errors.name"><b>{{ message }}</b></ng-container><span ng-bind-html="html"></span>`);
  assert.deepEqual(variables, ["a", "auth", "b", "c", "can", "d", "errors", "html", "items", "message", "p", "t"], "loop locals are not inputs; auth, can and errors are");
  assert.deepEqual(notes, []);
});

test("a view is composed into the layout it extends, sections fill yields, a held partial is inlined and a missing one is named", () => {
  const notes = [];
  const views = new Map([
    ["layouts/app.blade.php", `<html><body>@include('partials.nav')<main>@yield('content')</main><footer>@yield('foot', 'none')</footer></body></html>`],
    ["partials/nav.blade.php", `<nav>N</nav>`],
  ]);
  const composed = composeBlade(`@extends('layouts.app')@section('content')<h1>{{ $title }}</h1>@include('partials.gone')@endsection`, (p) => views.get(p) ?? null, (n) => notes.push(n));
  assert.equal(composed, `<html><body><nav>N</nav><main><h1>{{ $title }}</h1></main><footer>{{ 'none' }}</footer></body></html>`);
  assert.ok(notes.some((n) => /partials\.gone/.test(n)));
});

test("a run composes each view, skips the layout as a screen, reads the variables as inputs and ports it", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/blade") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("layouts-app"), "the layout is chrome, not a screen");
    const show = by("products-show");
    assert.ok(show && show.readBy === "blade");
    assert.match(show.template, /^<nav>/, "the layout's nav partial is composed in and the body is the screen");
    assert.match(show.template, /<ng-container ng-if="auth"><span class="who">/);
    assert.match(show.template, /<ng-container ng-if="product\.stock === 0">/);
    assert.match(show.template, /ng-if="!\(product\.stock === 0\) && \(product\.stock < 5\)"/);
    assert.match(show.template, /<ng-container ng-repeat="tag in product\.tags">/);
    assert.match(show.template, /<li class="\{\{ \(\$index == 0\) \? 'first' : '' \}\}">\{\{ tag\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(show.template, /<li class="none">No tags<\/li>/);
    assert.match(show.template, /ng-if="\(product\.type\) == 'shoe'"/);
    assert.match(show.template, /<span ng-bind-html="product\.description_html"><\/span>/);
    assert.doesNotMatch(show.template, /@\w+|\{\{--|\$product/);
    assert.deepEqual(show.inputs, ["auth", "can", "errors", "message", "product"]);
    assert.ok(by("partials-nav"), "the partial is also a screen of its own");
    assert.ok(run.ctx.screens.filter((s) => s.file.endsWith("show.blade.php")).length === 1, "one reader claimed the view");
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|@endsection/);
    assert.ok(run.ctx.report.unverified.some((n) => /@csrf|@method/.test(n)) && run.ctx.report.unverified.some((n) => /Laravel helper/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("a directive Blade does not know is printed as text, so email addresses and CSS at-rules survive", () => {
  const { template } = lowerBlade(`<p>Mail help@example.com (support) now</p>\n<style>@media (max-width: 600px) { .x { display: none } }</style>`, () => {});
  assert.equal(template, `<p>Mail help@example.com (support) now</p>\n<style>@media (max-width: 600px) { .x { display: none } }</style>`);
});

test("unspaced concatenation, prose after @else, and a layout's @section ... @show are read as Blade reads them", () => {
  const notes = [];
  assert.equal(phpToJs(`'Hello '.$name`), `'Hello ' + name`);
  assert.equal(phpToJs(`$a.' '.$b`), `a + ' ' + b`);
  assert.equal(lowerBlade(`@if($x)yes@else\n(No items)\n@endif`, () => {}).template, `<ng-container ng-if="x">yes</ng-container><ng-container ng-if="!(x)">\n(No items)\n</ng-container>`);
  const views = new Map([["layouts/app.blade.php", `<html>@section('sidebar')<p>DEFAULT</p>@show @yield('content')</html>`]]);
  const composed = composeBlade(`@extends('layouts.app')@section('sidebar')@parent<p>CHILD</p>@endsection@section('content')<p>C</p>@endsection`, (p) => views.get(p) ?? null, (n) => notes.push(n));
  assert.equal(composed, `<html><p>DEFAULT</p><p>CHILD</p> <p>C</p></html>`, "the child overrides the shown section and @parent splices the default back");
});
