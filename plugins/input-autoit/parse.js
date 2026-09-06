import { matchBracket, splitCommas } from "../dsp-ir/text.js";

/**
 * AutoIt: a Windows automation/scripting language whose GUI is ordinary
 * executable source, one `GUICtrlCreate*` call at a time, with no separate
 * declarative designer file at all, the same "screen built one statement in
 * source" pattern input-xbase reads from `@ SAY/GET`. `GUICreate(title,
 * width, height)` opens the one window this reader turns into a screen: a
 * whole `.au3` file is one screen, so a second `GUICreate` call is named as
 * an existing second window this reader does not read, rather than an
 * attempt to split the file that would guess at where one screen ends and
 * the next begins.
 *
 * A `GUICtrlCreate*` call is a positional argument list, not keyword
 * arguments, so each control's own real AutoIt signature is read positionally
 * (text first, then left, top, width, height, style). AutoIt gives every
 * control a return value, and this reader's whole read of "what field does
 * this control belong to" comes from the variable that return value is
 * assigned to (`$custNo = GUICtrlCreateInput(...)`), since the format has no
 * separate "bind this control to a named variable" argument the way Tcl's
 * `-textvariable` does.
 *
 * A button wires its action entirely through the event loop, not through any
 * argument on its own creation call, so a second pass scans the rest of the
 * file for a `Case $var` (inside a `Switch`/`EndSwitch`) or an `If $msg =
 * $var Then` block whose variable matches a button collected in the first
 * pass, and reads whichever single, clean function call statement stands
 * inside it as that button's wiring; anything else found there (more than one
 * statement, a bare keyword like `ExitLoop`, nothing at all) is a real gap
 * lower.js names rather than approximates.
 */

/** A physical line with everything from an unquoted `;` onward removed: AutoIt's own end of line comment, the
 * same role `#` plays in Tcl and `*` plays at the start of an xBase line. A doubled quote (`""`/`''`) inside a
 * string is AutoIt's own escaped quote, so it must not be read as the string closing early. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        if (line[i + 1] === quote) { i += 1; continue; } // a doubled quote: the escaped quote, string stays open
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ";") return line.slice(0, i);
  }
  return line;
}

/** Every physical line joined into the logical statement lines a trailing " _" spells: AutoIt's own real line
 * continuation character, the same "join before parsing" step input-xbase takes over its own trailing `;`. The
 * marker is a whitespace character followed by `_` at the true end of the line, dropped as the join point. */
function joinContinuations(lines) {
  const logical = [];
  let buffer = null;
  for (const raw of lines) {
    const line = stripComment(raw);
    if (buffer === null && !line.trim()) continue;
    const trimmedEnd = line.replace(/\s+$/, "");
    const continues = /\s_$/.test(trimmedEnd);
    const content = continues ? trimmedEnd.replace(/\s_$/, "") : trimmedEnd;
    buffer = buffer === null ? content : `${buffer} ${content.trim()}`;
    if (continues) continue;
    logical.push(buffer);
    buffer = null;
  }
  if (buffer !== null && buffer.trim()) logical.push(buffer);
  return logical;
}

/** `"..."` or `'...'`, AutoIt's own doubled-same-quote escape decoded, or null when the text is not one whole
 * literal in either spelling (a variable, an expression, a concatenation), which the caller names as a gap rather
 * than assumes anything from. */
export function parseAutoitString(raw) {
  const s = String(raw ?? "").trim();
  if (s.length < 2) return null;
  const q = s[0];
  if ((q !== '"' && q !== "'") || s[s.length - 1] !== q) return null;
  // A stray unescaped quote inside would end the literal before the text does; verifying the string closes only at
  // the very last character (walking it the same quote-aware way stripComment does) is what tells a real literal
  // apart from text that merely starts and ends with the same character.
  let i = 1;
  let closedAt = -1;
  while (i < s.length) {
    if (s[i] === q) {
      if (s[i + 1] === q) { i += 2; continue; }
      closedAt = i;
      break;
    }
    i += 1;
  }
  if (closedAt !== s.length - 1) return null;
  return s.slice(1, -1).split(q + q).join(q);
}

/** A bare AutoIt call name immediately followed by its own opening paren, at the very start of the trimmed text. */
function callAt(text) {
  const m = /^([A-Za-z_]\w*)\s*\(/.exec(text);
  return m ? { name: m[1], openIndex: m[0].length - 1 } : null;
}

/** One `$var = ...` (optionally `Global`/`Local`/`Dim`/`Const` qualified) assignment split into the variable and the
 * expression assigned, or null when the line assigns nothing: an ordinary call statement, control flow, anything
 * else this reader's vocabulary does not need to look inside. */
function splitAssignment(line) {
  const m = /^(?:Global\s+|Local\s+|Dim\s+|Const\s+)?\$(\w+)\s*=\s*([\s\S]+)$/i.exec(line.trim());
  return m ? { variable: m[1], rest: m[2].trim() } : null;
}

/**
 * A logical line's own `GUICtrlCreate*`/`GUICreate` call, if it opens with
 * one (after an optional assignment is peeled off first): the call's bare
 * name, its positional arguments split at the top level, and the variable it
 * was assigned to, or null. Not every logical line is a call this reader's
 * vocabulary wants: ordinary control flow (`While`, `If`, `EndSwitch`) has no
 * top level call at all and is silently passed over, the same restraint
 * input-xbase keeps over `PRIVATE`/`IF`/`ENDIF` lines around its own `@`
 * statements.
 */
function parseCall(line, problems) {
  const assign = splitAssignment(line);
  const rest = assign ? assign.rest : line.trim();
  const call = callAt(rest);
  if (!call) return null;
  const close = matchBracket(rest, call.openIndex, { strings: true, ticks: false });
  if (close === -1) {
    problems.push(`a \`${call.name}\` call has an argument list with no closing bracket; it is skipped.`);
    return null;
  }
  const argsText = rest.slice(call.openIndex + 1, close - 1);
  const args = splitCommas(argsText, { ticks: false });
  return { name: call.name, args, variable: assign ? assign.variable : null };
}

/** One resolved statement inside a `Case`/`If` body: the single clean `functionName(...)` call it is, or null when
 * the body is anything else (more than one statement, a bare keyword with no call at all, nothing). A keyword
 * statement like `ExitLoop` carries no parentheses, so it never matches the call shape and is named through the
 * caller's own "not read for what it does" note rather than mistaken for wiring. */
function cleanCall(body) {
  if (body.length !== 1) return null;
  const call = callAt(body[0]);
  if (!call) return null;
  const close = matchBracket(body[0], call.openIndex, { strings: true, ticks: false });
  return close === body[0].length ? call.name : null;
}

/**
 * The rest of the file scanned for how each button's own event loop wiring
 * reads: a `Case $var` block inside a `Switch`, closed by the next `Case` or
 * `EndSwitch`, or an `If $msg = $var Then` block (or its one line inline
 * form), closed by `EndIf`/`Else`/`ElseIf`. Returns a map from variable name
 * to either the one clean call name found there or `null` for a block that
 * exists but is not one clean call, so the caller can tell "wired to
 * something not read for what it does" apart from "never referenced at
 * all", which is a variable simply absent from this map.
 */
function scanWiring(lines) {
  const wiring = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    let m = /^Case\s+\$(\w+)\s*$/i.exec(trimmed);
    if (m) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const t = lines[j].trim();
        if (/^Case\b/i.test(t) || /^EndSwitch\b/i.test(t)) break;
        if (t) body.push(t);
      }
      wiring.set(m[1], cleanCall(body));
      continue;
    }

    m = /^If\s+\$msg\s*=\s*\$(\w+)\s*Then\s*(.*)$/i.exec(trimmed);
    if (m) {
      const inline = m[2].trim();
      let body = [];
      if (inline) {
        body = [inline];
      } else {
        let j = i + 1;
        for (; j < lines.length; j += 1) {
          const t = lines[j].trim();
          if (/^(EndIf|Else|ElseIf)\b/i.test(t)) break;
          if (t) body.push(t);
        }
      }
      wiring.set(m[1], cleanCall(body));
    }
  }
  return wiring;
}

/**
 * A whole `.au3` file read into the one window's controls it declares (in
 * declaration order, each with its own positional arguments and the variable
 * it was assigned to, or none), the count of `GUICreate` calls found (more
 * than one names a second window this reader does not read), and the button
 * wiring resolved from the rest of the file. `problems` names a call this
 * reader could not parse the argument list of at all.
 */
export function parseAutoit(source) {
  const lines = joinContinuations(String(source ?? "").replace(/\r\n/g, "\n").split("\n"));

  const controls = [];
  const guiCreateCalls = [];
  const problems = [];

  for (const line of lines) {
    const call = parseCall(line, problems);
    if (!call) continue;
    if (/^GUICreate$/i.test(call.name)) { guiCreateCalls.push(call.args); continue; }
    if (!/^GUICtrlCreate\w*$/i.test(call.name)) continue; // ordinary AutoIt source: not this reader's vocabulary
    controls.push(call);
  }

  const wiring = scanWiring(lines);

  return {
    title: guiCreateCalls.length ? parseAutoitString(guiCreateCalls[0][0]) : null,
    titleRaw: guiCreateCalls.length ? guiCreateCalls[0][0] : null,
    extraWindows: Math.max(0, guiCreateCalls.length - 1),
    controls,
    wiring,
    problems,
  };
}
