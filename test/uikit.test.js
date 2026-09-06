import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseUikit, parseObjcString } from "../plugins/input-uikit/parse.js";
import { lowerUikit } from "../plugins/input-uikit/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Raw Objective-C UIKit view construction: a screen built entirely through
 * `[[ClassName alloc] init...]`/`[ClassName classMethod:...]` message sends
 * plus `addSubview:` calls, with no separate declarative designer file at
 * all, the code-only sibling of input-storyboard's own `.storyboard`/`.xib`
 * reading. A whole `.m` file is one screen; a control's own field name comes
 * from the variable its construction was assigned to, and a button's wiring
 * comes from the `@selector(methodName)` inside its own `addTarget:action:`
 * `forControlEvents:` call.
 */

test("a label's plain literal caption, set through dot syntax, renders with no input", () => {
  const read = parseUikit(`
    @implementation X
    - (void)viewDidLoad {
      UILabel *custNoLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 10, 80, 20)];
      custNoLabel.text = @"Cust No:";
    }
    @end
  `);
  const lowered = lowerUikit(read);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("a label's plain literal caption, set through setText:, is recognised the same way", () => {
  const read = parseUikit(`
    @implementation X
    - (void)viewDidLoad {
      UILabel *passwordLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 100, 80, 20)];
      [passwordLabel setText:@"Password:"];
    }
    @end
  `);
  const lowered = lowerUikit(read);
  assert.match(lowered.template, /<p>Password:<\/p>/);
});

test("a label whose text is not a plain string literal is named, never guessed", () => {
  const read = parseUikit(`
    @implementation X
    - (void)viewDidLoad {
      UILabel *nameLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 40, 80, 20)];
      nameLabel.text = [self computedNameLabel];
    }
    @end
  `);
  const lowered = lowerUikit(read);
  assert.doesNotMatch(lowered.template, /<p>/);
  assert.ok(lowered.notes.some((n) => /is not a plain string literal/.test(n)));
});

test("a text field assigned to a variable takes its field name from that variable", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UITextField *custNoField = [[UITextField alloc] initWithFrame:CGRectMake(100, 10, 200, 20)];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<input id="f-custNoField" type="text" ng-model="custNoField">/);
  assert.deepEqual(lowered.fields, ["custNoField"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a text field never assigned to a variable is a real gap, named rather than invented", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      [[UITextField alloc] initWithFrame:CGRectMake(100, 70, 200, 20)];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
  assert.ok(lowered.notes.some((n) => /never assigned to a variable/.test(n)));
});

test("secureTextEntry, set through dot syntax, marks a password field", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UITextField *passwordField = [[UITextField alloc] initWithFrame:CGRectMake(100, 100, 200, 20)];
      passwordField.secureTextEntry = YES;
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<input id="f-passwordField" type="password" ng-model="passwordField">/);
});

test("secureTextEntry, set through setSecureTextEntry:, is recognised the same way", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UITextField *pwField = [[UITextField alloc] initWithFrame:CGRectMake(100, 100, 200, 20)];
      [pwField setSecureTextEntry:YES];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /type="password"/);
});

test("a switch binds ng-model to its own assigned variable", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UISwitch *activeSwitch = [[UISwitch alloc] initWithFrame:CGRectMake(10, 130, 50, 30)];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<input id="f-activeSwitch" type="checkbox" ng-model="activeSwitch">/);
});

test("a button built with buttonWithType: and a clean @selector wiring resolves that selector as its output", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UIButton *okButton = [UIButton buttonWithType:UIButtonTypeSystem];
      [okButton setTitle:@"OK" forState:UIControlStateNormal];
      [okButton addTarget:self action:@selector(handleOk) forControlEvents:UIControlEventTouchUpInside];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
});

test("a button with no addTarget:action:forControlEvents: call is named as unwired", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UIButton *cancelButton = [UIButton buttonWithType:UIButtonTypeSystem];
      [cancelButton setTitle:@"Cancel" forState:UIControlStateNormal];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /no addTarget:action:forControlEvents: call/.test(n)));
});

test("a button whose setTitle: argument is not a plain string literal is named, never guessed", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UIButton *dynButton = [UIButton buttonWithType:UIButtonTypeSystem];
      [dynButton setTitle:someTitleVar forState:UIControlStateNormal];
      [dynButton addTarget:self action:@selector(doThing) forControlEvents:UIControlEventTouchUpInside];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<button type="button" ng-click="onDoThing\(\)"><\/button>/);
  assert.ok(lowered.notes.some((n) => /setTitle:forState: argument is not a plain string literal/.test(n)));
});

test("a UITextField built via [[ClassName alloc] init...] is recognised regardless of the frame arguments", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UITextField *f = [[UITextField alloc] initWithFrame:CGRectZero];
    }
  `);
  assert.equal(read.controls.length, 1);
});

test("a UITextView is named present, its content never invented", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UITextView *notesView = [[UITextView alloc] initWithFrame:CGRectMake(10, 170, 300, 80)];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.equal(lowered.template, "<div>\n</div>");
  assert.ok(lowered.notes.some((n) => /`notesView` is a UITextView/.test(n)));
});

test("controls render in construction order, not the order they are configured or added to the view", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      UILabel *labelA = [[UILabel alloc] initWithFrame:CGRectMake(0, 0, 10, 10)];
      UILabel *labelB = [[UILabel alloc] initWithFrame:CGRectMake(0, 20, 10, 10)];
      labelB.text = @"B";
      labelA.text = @"A";
      [self.view addSubview:labelB];
      [self.view addSubview:labelA];
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  const captions = [...lowered.template.matchAll(/<p>(\w+)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(captions, ["A", "B"], "labelA was constructed first, so it renders first, regardless of add order");
});

test("more than one @implementation in a file is not split into multiple screens", () => {
  const read = parseUikit(`
    @implementation First
    - (void)viewDidLoad {
      UILabel *a = [[UILabel alloc] initWithFrame:CGRectZero];
      a.text = @"A";
    }
    @end
    @implementation Second
    - (void)viewDidLoad {
      UILabel *b = [[UILabel alloc] initWithFrame:CGRectZero];
      b.text = @"B";
    }
    @end
  `);
  assert.equal(read.implementations, 2);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<p>A<\/p>/);
  assert.match(lowered.template, /<p>B<\/p>/);
  assert.ok(lowered.notes.some((n) => /@implementation blocks found/.test(n)));
});

test("Objective-C is case sensitive: a differently cased spelling is not this reader's vocabulary", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      uilabel *x = [[uilabel alloc] initWithFrame:CGRectZero];
    }
  `);
  assert.equal(read.controls.length, 0);
});

test("a // comment does not swallow the statement after it, and a string is left untouched by comment stripping", () => {
  const read = parseUikit(`
    - (void)viewDidLoad {
      // a plain comment
      UILabel *a = [[UILabel alloc] initWithFrame:CGRectZero]; // trailing comment
      a.text = @"http://example.com";
    }
  `);
  const lowered = lowerUikit(read, "fallback");
  assert.match(lowered.template, /<p>http:\/\/example\.com<\/p>/);
});

test("an escaped quote inside a string literal decodes to one literal quote character", () => {
  assert.equal(parseObjcString('@"She said \\"hi\\""'), 'She said "hi"');
  assert.equal(parseObjcString('"plain, no @ prefix"'), "plain, no @ prefix");
  assert.equal(parseObjcString("someVariable"), null);
  assert.equal(parseObjcString('[self computeThing]'), null);
});

test("a full customer screen, built entirely as raw UIKit construction, ports to React through the unchanged pipeline, with no raw Objective-C syntax leaking", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/uikit") });
  try {
    assert.equal(run.error, null);
    const uikitScreens = run.ctx.screens.filter((s) => s.readBy === "uikit");
    assert.equal(uikitScreens.length, 1, "a whole .m file is one screen");

    const screen = uikitScreens[0];
    assert.equal(screen.title, "CustomerViewController");
    assert.ok(screen.outputs.includes("handleOk"), "the OK button's own @selector resolved to a real output");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Password:/);
    assert.match(jsx, /OK/);
    assert.match(jsx, /Cancel/);
    assert.match(jsx, /onClick=\{\(\) => onHandleOk\(\)\}/);
    assert.doesNotMatch(
      jsx,
      /\[\[UILabel alloc\]|initWithFrame:CGRect|@selector\(handleOk\)|addTarget:self|@"Cust No:"|@"OK"|@"Cancel"/,
      "no raw Objective-C construction syntax, message sends or string literal spellings survived into the port",
    );

    const md = await readFile(join(run.out, "UIKIT.md"), "utf8");
    assert.match(md, /CustomerViewController\.m/);
    assert.match(md, /CustomerViewController/);
    assert.match(md, /never assigned to a variable/);
    assert.match(md, /no addTarget:action:forControlEvents: call/);
    assert.match(md, /is a UITextView/);
    assert.doesNotMatch(
      md,
      /\[\[UILabel alloc\]|initWithFrame:CGRect|@selector\(handleOk\)|addTarget:self|@"Cust No:"|@"OK"|@"Cancel"/,
      "no raw Objective-C construction syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
