import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { isEmberTemplate, lowerExpr, lowerGlimmer, readMembers, readComponent } from "../plugins/input-ember/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * input-ember reads a Glimmer template and its class onto the shared dialect:
 * block params name the loop item, @args are inputs, this.args.onX calls are
 * outputs, {{on}} and {{action}} are events, <Input @value> is a model and
 * {{yield}} is the projection. A .hbs file is owned by exactly one reader.
 */

test("the ownership predicate tells a Glimmer template from plain handlebars", () => {
  assert.equal(isEmberTemplate("{{#each xs as |x|}}{{x}}{{/each}}"), true);
  assert.equal(isEmberTemplate("<p>{{@title}}</p>"), true);
  assert.equal(isEmberTemplate('<button {{on "click" this.go}}>x</button>'), true);
  assert.equal(isEmberTemplate("<UserBadge @u={{x}} />"), true);
  assert.equal(isEmberTemplate("<h1>{{title}}</h1>{{#each rows}}<p>{{this.label}}</p>{{/each}}"), false, "plain handlebars is not claimed");
  assert.equal(isEmberTemplate("<p>{{x}}</p>", "app/components/x.hbs"), true, "the Ember components folder is claimed by location");
});

test("expressions: helpers with an exact spelling become that JS; others become a named call", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(lowerExpr("this.name"), "name");
  assert.equal(lowerExpr("@title"), "title");
  assert.equal(lowerExpr('if this.a "x" "y"', note), '(a ? "x" : "y")');
  assert.equal(lowerExpr("eq this.kind 'admin'", note), "(kind === 'admin')");
  assert.equal(lowerExpr("(and this.a (not this.b))", note), "(a && !b)");
  assert.equal(lowerExpr("fn this.pick user", note), "pick(user)");
  assert.deepEqual(notes, [], "exact helpers carry no note");
  assert.equal(lowerExpr("format-date this.when", note), "format-date(when)");
  assert.ok(notes.some((n) => /format-date/.test(n)), "an unknown helper is named for a person");
});

test("blocks lower with the dialect's own spellings, block params named, index reshaping the loop", () => {
  const { template } = lowerGlimmer('{{#each @users as |user idx|}}<li>{{idx}} {{user.name}}</li>{{else}}<li>none</li>{{/each}}');
  assert.match(template, /<ng-container ng-repeat="user in users track by \$index">/, "the block param names the item and the index reshapes the loop");
  assert.match(template, /\{\{ \$index \}\} \{\{ user\.name \}\}/);
  assert.match(template, /ng-if="!users \|\| !users\.length"/, "the each-else is the empty state");
  const { template: t2 } = lowerGlimmer("{{#if this.a}}A{{else if this.b}}B{{else}}C{{/if}}");
  assert.match(t2, /ng-if="a"/);
  assert.match(t2, /ng-if="!\(a\) && \(b\)"/);
  assert.match(t2, /ng-if="!\(a\) && !\(b\)"/);
});

test("tags: modifiers, @args, bound attributes, built ins, child components and yield", () => {
  const { template, outputs } = lowerGlimmer([
    '<button disabled={{this.busy}} {{on "click" this.save}}>Save</button>',
    '<button {{action "pick" item}}>Pick</button>',
    '<Input @value={{this.q}} placeholder="Search" />',
    '<UserBadge @user={{this.sel}} @onPick={{this.pick}} />',
    '<a {{on "click" @onClose}}>x</a>',
    "{{yield}}",
  ].join(""));
  assert.match(template, /<button ng-disabled="busy" ng-click="save\(\)">Save<\/button>/);
  assert.match(template, /<button ng-click="pick\(item\)">Pick<\/button>/, "classic action lowers with its arguments");
  assert.match(template, /<input ng-model="q" placeholder="Search">/, "<Input @value> is a model on a real input");
  assert.match(template, /<user-badge ng-attr-user="\{\{ sel \}\}" ng-pick="pick\(\)"><\/user-badge>/, "a child component's args and callbacks");
  assert.match(template, /<a ng-click="onClose\(\)">x<\/a>/);
  assert.deepEqual(outputs, ["close"], "an @onX wired as a handler is this component's output, named as the event");
  assert.match(template, /<ng-transclude><\/ng-transclude>/, "yield is the projection");
  assert.doesNotMatch(template, /\{\{on|\{\{action|@value|<Input|<UserBadge/);
});

test("members: template @args and class this.args are inputs; this.args.onX calls are outputs; a child's @arg is not ours", () => {
  const template = '<h2>{{@title}}</h2>{{#each @users as |u|}}{{u}}{{/each}}<UserBadge @user={{this.s}} @onPick={{this.pick}} />';
  const source = 'get loading() { return this.args.users == null; } pick(u) { this.args.onPick?.(u); } save() { this.args.onSave(this.q); }';
  const m = readMembers(template, source);
  assert.deepEqual(m.inputs.sort(), ["title", "users"]);
  assert.deepEqual(m.outputs.sort(), ["pick", "save"]);
});

test("a run reads the Ember component once, the plain handlebars template once, and never the same file twice", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ember") });
  try {
    assert.equal(run.error, null);
    const card = run.ctx.screens.filter((s) => s.selector === "user-card");
    assert.equal(card.length, 1, "exactly one reader claimed user-card.hbs");
    assert.equal(card[0].readBy, "ember");
    assert.deepEqual(card[0].inputs.sort(), ["title", "users"]);
    assert.deepEqual(card[0].outputs.sort(), ["pick", "save"]);
    assert.equal(card[0].usesTwoWay, true);
    assert.match(card[0].template, /ng-repeat="user in users track by \$index"/);
    assert.ok(run.ctx.api.calls.some((c) => c.path === "/api/users"), "the class's fetch reached the API surface");

    const plain = run.ctx.screens.filter((s) => s.selector === "plain");
    assert.equal(plain.length, 1, "the plain .hbs template is read by exactly one reader");
    assert.equal(plain[0].readBy, "handlebars", "and that reader is handlebars, now that .hbs reaches the scan");
    assert.ok(run.ctx.written.some((f) => /src\/features\/UserCard\/UserCard\.jsx$/.test(f)), "the Ember component ported to React");
  } finally {
    await run.cleanup();
  }
});
