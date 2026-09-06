import assert from "node:assert/strict";
import test from "node:test";

import { attrSafe, matchBracket, splitCommas, splitWords } from "../plugins/dsp-ir/text.js";

/**
 * The three string helpers every template reader shares, held to one
 * definition: a bracket matcher that says when it fails, and two argument
 * splitters that keep brackets and strings whole.
 */

test("matchBracket returns the index past the close, -1 when unbalanced, and reads quotes only where told", () => {
  assert.equal(matchBracket(`(a, "b)", [c])`, 0), 14);
  assert.equal(matchBracket(`{ x: "}" }`, 0), 10);
  assert.equal(matchBracket(`(never`, 0), -1);
  assert.equal(matchBracket(`{<p>Don't panic</p>}`, 0, { strings: false }), 20, "an apostrophe in markup is prose");
  assert.equal(matchBracket(`{<p>Don't panic</p>}`, 0), -1, "read as code, the same apostrophe opens a string that never closes");
  assert.equal(matchBracket("(`)`)", 0, { ticks: false }), 3, "a backtick is not a string in C# or Java templates");
  assert.equal(matchBracket("(`)`)", 0), 5, "and is in JS");
  assert.equal(matchBracket("x", 0), -1, "not a bracket at all");
});

test("splitCommas keeps brackets and strings whole, trims, and drops a trailing empty item", () => {
  assert.deepEqual(splitCommas(`"a, b", { x: [1, 2], y: "c,d" }, m("i", "z"), `), [`"a, b"`, `{ x: [1, 2], y: "c,d" }`, `m("i", "z")`]);
  assert.deepEqual(splitCommas("a,,b"), ["a", "", "b"], "an empty middle item is kept, as a missing argument");
});

test("splitWords splits at top level whitespace only", () => {
  assert.deepEqual(splitWords(`name="a b" size=(1 + 2) plain`), [`name="a b"`, `size=(1 + 2)`, "plain"]);
});

test("attrSafe turns the double quotes an attribute value cannot hold into single ones", () => {
  assert.equal(attrSafe(`a == "x"`), `a == 'x'`);
});
