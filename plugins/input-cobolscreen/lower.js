import { pascal } from "../dsp-ir/emit.js";

/**
 * What a COBOL `SCREEN SECTION` group means, once parse.js has handed it
 * over as plain entries. An `01` level entry is one physical screen, the
 * same "one structural unit, one screen" precedent input-storyboard sets
 * for a scene and input-cics sets for a `DFHMDI` map. Its nested `02`/`03`
 * entries are the screen's own elements; SCREEN SECTION entries are
 * conventionally already declared top to bottom, so this reader keeps the
 * declaration order rather than re-sorting by LINE/COLUMN the way
 * input-cics sorts BMS fields by POS, since a COBOL author (unlike BMS's
 * flat DFHMDF list) already wrote the vertical order that matters.
 *
 * A COBOL program's `ACCEPT`/`DISPLAY` statements and whatever the
 * PROCEDURE DIVISION does with a function key live entirely outside the
 * SCREEN SECTION, in code this reader does not read, so this reader
 * produces zero outputs, ever, the same honest zero input-jasperreports,
 * input-birt, input-cics and input-informix already give a format with no
 * button or event anywhere in it.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};

/** A name the emitted JavaScript can declare: a COBOL data-name that spells a reserved word gets a suffix. Not
 * shared with the other readers' copies of this table: each keeps its own, since the naming choices differ reader
 * to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [],
    note(text) { if (!notes.includes(text)) notes.push(text); },
    notes,
    unique(base) {
      const stem = declarable(base || "field");
      let name = stem; let n = 2;
      while (names.has(name)) name = `${stem}${n++}`;
      names.add(name);
      return name;
    },
  };
}

/** The identifying text a note names an entry by: its own data-name once camelCased, or its caption when it has
 * neither a name nor a bound field, or a plain fallback when it has neither. */
function label(entry, fieldName) {
  if (fieldName) return `\`${fieldName}\``;
  if (entry.valueLiteral) return `"${entry.valueLiteral}"`;
  return "an unlabeled entry";
}

/**
 * One entry rendered, or null when it produces nothing at all: `BLANK
 * SCREEN` (skipped silently, informational the same way BMS's `DFHMSD
 * TYPE=FINAL` is), a `PIC`/`PICTURE` clause with none of `USING`, `FROM` or
 * `TO` (named through `note` rather than guessed which way it binds), or a
 * bare group level with neither a `VALUE` nor a `PIC` (expected structure,
 * the `01` header itself most often).
 */
function renderEntry(entry, state) {
  if (entry.blankScreen) return null;

  let rendered = null;

  if (entry.valueRaw) {
    if (entry.valueLiteral !== null) {
      rendered = { line: `<p>${esc(entry.valueLiteral)}</p>`, field: null };
    } else {
      state.note(`${label(entry, null)}'s VALUE is not a plain quoted literal; nothing was assumed from it.`);
      return null;
    }
  } else if (entry.pic) {
    if (entry.picMode === "USING" || entry.picMode === "TO") {
      const field = state.unique(declarable(camel(entry.picTarget)) || "field");
      if (entry.required) {
        state.note(`\`${field}\` is marked REQUIRED; the port must enforce this itself, since no validation behaviour was observed to carry across as a real HTML \`required\` attribute.`);
      }
      state.fields.push(field);
      rendered = { line: `<input id="f-${field}" type="text" ng-model="${field}">`, field };
    } else if (entry.picMode === "FROM") {
      // Display only: the program writes here but the operator cannot type into it. Rendered as a bare dialect
      // interpolation of the value the port is handed, the same honest choice input-informix already makes for its
      // own NOENTRY fields, rather than a disabled-looking input this reader has no state to actually disable.
      const field = declarable(camel(entry.picTarget));
      rendered = { line: `<span>{{ ${field} }}</span>`, field: null };
    } else {
      state.note(`${label(entry, null)} declares a PIC/PICTURE clause with none of USING, FROM or TO; it is unclear which way it binds, so nothing was rendered for it.`);
      return null;
    }
  } else {
    return null; // a bare group level entry: expected structure, not a gap
  }

  if ((entry.line?.relative || entry.column?.relative)) {
    state.note(`${label(entry, rendered.field)} uses a relative LINE PLUS/COLUMN PLUS position; this reader does not compute the resulting absolute position, so it is rendered in declaration order only.`);
  }

  return rendered;
}

/**
 * One `01` level SCREEN SECTION group lowered onto the shared dialect: no
 * conditional, no loop, no interpolation but for a `FROM` field's read only
 * value, since a COBOL screen is a flat list of positioned captions and
 * fields with nothing computed.
 */
export function lowerCobolScreen(screen) {
  const state = makeState();
  const lines = [];
  for (const entry of screen.entries) {
    const rendered = renderEntry(entry, state);
    if (rendered) lines.push(`  ${rendered.line}`);
  }

  const stem = screen.name ? kebab(screen.name) : null;
  const title = screen.name || "COBOL Screen";
  const className = pascal(stem || kebab(title) || "cobol-screen");

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [],
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title,
    className,
  };
}
