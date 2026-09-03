import assert from "node:assert/strict";
import test from "node:test";

import { DIALECTS } from "../plugins/dsp-ir/ir.js";
import { expand } from "../plugins/input-knockout/expand.js";
import { translate } from "../plugins/output-react/template.js";
import { toVue } from "../plugins/output-vue/print.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { toHtml } from "../plugins/output-html/print.js";
import { toSolid } from "../plugins/output-solid/index.js";
import { toAlpine } from "../plugins/output-alpine/index.js";
import { toAngular } from "../plugins/output-angular/print.js";
import { toLit } from "../plugins/output-lit/index.js";
import { Policy, PolicyViolation } from "../src/core/policy.js";

/**
 * The byte identical gate, widened twice: knockout joins Angular and Vue as
 * a third way to write the same screen, and the newer targets join the
 * older ones as outputs that must not care which dialect wrote the input.
 */

const ANGULAR = `<ul><li *ngFor="let o of xs" [class.hot]="o.hot">{{o.name}}</li></ul>`;
const VUE = `<ul><li v-for="o in xs" :class="{hot: o.hot}">{{o.name}}</li></ul>`;
const KNOCKOUT = expand(`<ul data-bind="foreach: { data: xs, as: 'o' }"><li data-bind="css: { hot: o.hot }, text: o.name"></li></ul>`);
const ko = { dialect: DIALECTS.knockout };

test("the same screen in knockout emits the same bytes as angular and vue", () => {
  assert.equal(toVue(ANGULAR).markup, toVue(KNOCKOUT, ko).markup);
  assert.equal(toSvelte(ANGULAR).markup, toSvelte(KNOCKOUT, ko).markup);
  assert.equal(toHtml(ANGULAR).markup, toHtml(KNOCKOUT, ko).markup);
  assert.equal(
    translate(ANGULAR, { indent: 0 }).jsx,
    translate(KNOCKOUT, { indent: 0, ...ko }).jsx,
  );
});

test("the newer targets are as dialect blind as the founding four", () => {
  assert.equal(toSolid(ANGULAR).body, toSolid(VUE).body);
  assert.equal(toAlpine(ANGULAR).markup, toAlpine(VUE).markup);
  assert.equal(toAngular(ANGULAR).markup, toAngular(VUE).markup);
  const a = toLit(ANGULAR);
  const v = toLit(VUE);
  // The dialect field is provenance and is supposed to differ; the code the
  // element renders is not.
  assert.equal(a.template ?? a.markup ?? a.body, v.template ?? v.markup ?? v.body);
});

test("the newer credential shapes stop the run like the old ones", () => {
  const cases = [
    ["ghp_" + "a1B2".repeat(9), "github token"],
    ["github_pat_" + "x9".repeat(15), "github fine grained token"],
    ["glpat-" + "ab12".repeat(6), "gitlab token"],
    ["sk_live_" + "q7w8".repeat(5), "stripe live key"],
    ["npm_" + "z0".repeat(18), "npm token"],
    ["AIza" + "Bc-9".repeat(9), "google api key"],
    ["eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxIn0" + "." + "sig4t_ure", "signed jwt"],
  ];
  for (const [value, kind] of cases) {
    const policy = new Policy({});
    policy.scanForSecrets(`const t = "${value}";`, "legacy/app.js");
    assert.ok(policy.findings.some((f) => f.kind === kind), `${kind} should be caught`);
    assert.throws(() => policy.assertNoSecrets(), PolicyViolation, kind);
  }
  const clean = new Policy({});
  clean.scanForSecrets(`const url = "/api/orders"; const label = "eyJust a caption, not.a.token";`, "legacy/app.js");
  assert.doesNotThrow(() => clean.assertNoSecrets());
});
