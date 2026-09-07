import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseFluid } from "../plugins/input-fluid/parse.js";
import { lowerFluid } from "../plugins/input-fluid/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * FLTK's own FLUID `.fl` designer files, the brace nested declarative format
 * that has laid out FLTK's C++ desktop and embedded front ends since the
 * 1990s. A root `Fl_Window` inside a `Function {}` block is a real component
 * boundary, so it lowers onto the AngularJS attribute dialect the rest of
 * the tool already reads, one screen per root window, the same "one
 * structural unit, one screen" shape input-storyboard and input-cics already
 * give their own formats.
 */

function firstWindow(source) {
  const { functions, problems } = parseFluid(source);
  assert.deepEqual(problems, []);
  const win = functions[0].children.find((n) => /Window$/.test(n.class));
  return win;
}

test("a window's own label is informational chrome, never rendered as a body caption", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    label {Customer Maintenance}
    xywh {0 0 100 100}
  } {
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.equal(lowered.title, "Customer Maintenance");
  assert.doesNotMatch(lowered.template, /<p>Customer Maintenance<\/p>|<h\d>Customer Maintenance/, "the window label is chrome, not a paragraph in the body");
});

test("a label attached directly to an input's own node is paired with it as a preceding caption", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Input custName {
      label {Name:}
      xywh {10 10 100 20}
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.match(lowered.template, /<label for="f-custName">Name:<\/label>\s*\n\s*<input id="f-custName" type="text" ng-model="custName">/);
  assert.deepEqual(lowered.fields, ["custName"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a clean functionName(...) callback resolves to a wired output", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Button okButton {
      label {OK}
      callback {handleOk(o,v);}
      xywh {10 10 80 25}
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.equal(lowered.notes.length, 0, "a clean call shape is not a gap");
});

test("a callback that is not a recognizable functionName(...) call is named through a note, never invented", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Button {} {
      label {Cancel}
      callback {counter++;}
      xywh {10 10 80 25}
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /not a recognizable `functionName\(\.\.\.\)` call shape/.test(n)));
});

test("Fl_Round_Buttons sharing an immediate parent Fl_Group are grouped by that parent, not by consecutive siblings", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Group planGroup {
      xywh {0 0 100 50}
    } {
      Fl_Round_Button planBasic {
        label {Basic}
        xywh {0 0 40 20}
      }
      Fl_Round_Button planPro {
        label {Pro}
        xywh {40 0 40 20}
      }
    }
    Fl_Group otherGroup {
      xywh {0 50 100 50}
    } {
      Fl_Round_Button otherOnly {
        label {Only}
        xywh {0 50 40 20}
      }
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  const groups = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.equal(groups[0], groups[1], "the two radios sharing planGroup share one field");
  assert.notEqual(groups[0], groups[2], "a radio in a different parent group is a different field");
  assert.equal(new Set(lowered.fields).size, lowered.fields.length, "each group is registered once");
});

test("an anonymous widget (no name between the class and the brace) is handled with no invented name", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Button {} {
      label {OK}
      callback {handleOk(o,v);}
      xywh {10 10 80 25}
    }
  }
}`;
  const { functions } = parseFluid(src);
  const win = functions[0].children[0];
  const button = win.children[0];
  assert.ok(!button.name, "an anonymous widget's own name is the empty brace it was written with, never an invented one");
  const lowered = lowerFluid(win);
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
});

test("a visual/behavioral flag like hide, visible or labelfont is never named per occurrence", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100} visible
  } {
    Fl_Input custName {
      label {Name:}
      labelfont {1}
      xywh {10 10 100 20} hide
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.equal(lowered.notes.length, 0, "hide, visible and labelfont carry no rendering meaning this reader translates, and are never named");
});

test("multiple Function {} blocks, each opening its own root window, become multiple screens", () => {
  const src = `Function {make_first()} {open
} {
  Fl_Window first {
    xywh {0 0 100 100}
  } {
    Fl_Input firstField {
      label {First:}
      xywh {10 10 80 20}
    }
  }
}

Function {make_second()} {open
} {
  Fl_Window second {
    xywh {0 0 100 100}
  } {
    Fl_Input secondField {
      label {Second:}
      xywh {10 10 80 20}
    }
  }
}`;
  const { functions, problems } = parseFluid(src);
  assert.deepEqual(problems, []);
  assert.equal(functions.length, 2);
  const windows = functions.map((fn) => fn.children.find((n) => /Window$/.test(n.class)));
  assert.deepEqual(windows.map((w) => w.name), ["first", "second"]);
  const lowered = windows.map((w) => lowerFluid(w));
  assert.deepEqual(lowered.map((l) => l.fields), [["firstField"], ["secondField"]]);
});

test("a Fl_Choice with no inline MenuItem options is named as filled from code, never invented", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Choice stateChoice {
      label {State:}
      xywh {10 10 100 20}
    } {
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.match(lowered.template, /ng-repeat="option in stateChoiceOptions"/);
  assert.ok(lowered.notes.some((n) => /filled from code at runtime/.test(n)));
});

test("a Fl_Choice with inline MenuItem children reads them as real options", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Choice stateChoice {
      label {State:}
      xywh {10 10 100 20}
    } {
      MenuItem {} {
        label {CA}
        xywh {0 0 100 20}
      }
      MenuItem {} {
        label {NY}
        xywh {0 20 100 20}
      }
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.match(lowered.template, /<option>CA<\/option>/);
  assert.match(lowered.template, /<option>NY<\/option>/);
  assert.equal(lowered.notes.length, 0);
});

test("a widget class with no vocabulary entry is named rather than approximated", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Clock aClock {
      xywh {10 10 40 40}
    }
  }
}`;
  const win = firstWindow(src);
  const lowered = lowerFluid(win);
  assert.ok(lowered.notes.some((n) => /widget class `Fl_Clock`.*is not lowered/.test(n)));
});

test("a callback that is a brace-quoted multi-line C++ body is read whole, its own braces balanced correctly", () => {
  const src = `Function {make_window()} {open
} {
  Fl_Window w {
    xywh {0 0 100 100}
  } {
    Fl_Button okButton {
      label {OK}
      callback {handleOk(o,v);
if (v) {
  doSomething();
}}
      xywh {10 10 80 25}
    }
  }
}`;
  const { functions, problems } = parseFluid(src);
  assert.deepEqual(problems, []);
  const win = functions[0].children.find((n) => /Window$/.test(n.class));
  const lowered = lowerFluid(win);
  assert.deepEqual(lowered.outputs, ["handleOk"], "the callback still resolves from its own leading functionName(...) call despite the nested braces after it");
});

test("a FLUID customer maintenance screen ports to React through the unchanged pipeline, with no raw FLUID syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/fluid") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "fluid");
    assert.ok(screen, "the FLUID .fl file was read");
    assert.equal(screen.title, "Customer Maintenance");
    assert.deepEqual(screen.outputs, ["handleOk"]);

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /Name:/);
    assert.match(jsx, /Active/);
    assert.match(jsx, /Basic/);
    assert.match(jsx, /Pro/);
    assert.match(jsx, /OK/);
    assert.match(jsx, /Cancel/);
    assert.match(jsx, /onChange=\{\(event\) => setCustName\(event\.target\.value\)\}/);
    assert.match(jsx, /onClick=\{\(\) => onHandleOk\(\)\}/);
    assert.doesNotMatch(jsx, /Customer Maintenance/, "the window's own label is chrome, never printed into the body");
    assert.doesNotMatch(
      jsx,
      /Fl_Window|Fl_Input|Fl_Check_Button|Fl_Round_Button|Fl_Group|xywh|callback\s*\{|handleOk\(o,v\);|Function\s*\{/,
      "no raw FLUID syntax survived into the port",
    );

    const md = await readFile(join(run.out, "FLUID.md"), "utf8");
    assert.match(md, /custmaint\.fl/);
    assert.match(md, /Customer Maintenance/);
    assert.match(md, /not a recognizable `functionName\(\.\.\.\)` call shape/);
    assert.doesNotMatch(
      md,
      /Fl_Window|Fl_Input|Fl_Check_Button|Fl_Round_Button|xywh|callback\s*\{|handleOk\(o,v\);|counter\+\+;|Function\s*\{/,
      "no raw FLUID syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
