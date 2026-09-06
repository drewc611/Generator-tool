/**
 * Raw Objective-C UIKit view construction: pre-Storyboard era iOS code (or
 * code that deliberately avoids Interface Builder) that builds a screen
 * entirely through `[[ClassName alloc] init...]`/`[ClassName classMethod:...]`
 * message sends plus `addSubview:` calls, with no separate declarative
 * designer file at all. This is the code-only sibling of input-storyboard,
 * reading the same kind of screen a developer could equally have built as a
 * `.storyboard`.
 *
 * This reader stays UIKit only, not also AppKit's `NSTextField`/`NSButton`/
 * `NSSwitch` spellings: the two frameworks' property and setter names differ
 * in real ways (AppKit has no `secureTextEntry`, its target/action shape
 * differs), so recognising both under one vocabulary would either miss those
 * differences or blur them, and UIKit alone is a narrow, honest scope
 * boundary matching every other reader's own single-dialect restraint.
 *
 * There is no separate boundary marker the way a `<scene>` element or a
 * `.frm`'s own file extension is, so a whole `.m` file is one screen, the
 * same "no boundary but the file itself" choice input-tk and input-autoit
 * already make for their own source-only formats; a file declaring more than
 * one `@implementation` or `viewDidLoad` is read whole rather than split,
 * since splitting it would be a guess about where one screen ends and the
 * next begins.
 *
 * This is a hand-written statement scanner, not a real Objective-C parser:
 * comments and string literals are stripped and decoded just enough to find
 * statement boundaries, then each statement is matched against this reader's
 * own narrow vocabulary of construction and configuration shapes. A
 * construction statement's own assigned variable is this reader's whole
 * notion of a control's identity, the same "identity from assignment" rule
 * input-autoit already keeps over its own `GUICtrlCreate*` return values.
 */

const KNOWN_CLASSES = ["UILabel", "UITextField", "UISwitch", "UIButton", "UITextView"];

/** Every comment removed, string literals (both `@"..."` and bare `"..."`, which share the same double quote and
 * backslash escaping) left untouched so a `//` or `/*` inside one is never mistaken for a comment opening. */
function stripComments(source) {
  const s = String(source ?? "");
  let out = "";
  let quote = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === "\\") { i += 1; if (i < s.length) out += s[i]; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i += 1; out += "\n"; continue; }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * The comment-stripped source split into logical statements at each top
 * level `;`, parens and brackets kept balanced so a nested message send like
 * `[[UILabel alloc] initWithFrame:CGRectMake(10, 10, 80, 20)]` never splits
 * early. Braces are not tracked at all: this reader's vocabulary is a
 * straight-line sequence of construction and configuration statements, not
 * control flow, so a `{`/`}` around them is simply text the split walks
 * through, the same restraint that keeps this a statement scanner rather
 * than a parser.
 */
function splitStatements(text) {
  const statements = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    // `{`/`}` split too, same as `;`: a method signature ("- (void)viewDidLoad {") or a block's own braces would
    // otherwise glue onto whatever statement follows, since neither ends in a semicolon of its own. Splitting on
    // them (rather than tracking their nesting) is enough for this vocabulary, which never opens a brace inside a
    // message send.
    else if ((c === ";" || c === "{" || c === "}") && depth <= 0) {
      const stmt = text.slice(start, i).trim();
      if (stmt) statements.push(stmt);
      start = i + 1;
      depth = 0; // a stray unmatched closer before the boundary must not leak negative depth into the next statement
    }
  }
  const last = text.slice(start).trim();
  if (last) statements.push(last);
  return statements;
}

/**
 * `@"..."` or a bare `"..."`, Objective-C's own `\"` escape decoded, or null
 * when the text is not one whole literal (a variable, a method call, string
 * concatenation), which the caller names as a gap rather than assumes
 * anything from. The `@` is part of the literal syntax, not the string's own
 * content, so it is peeled off before the quote is read.
 */
export function parseObjcString(raw) {
  const s = String(raw ?? "").trim();
  const body = s.startsWith("@") ? s.slice(1).trim() : s;
  if (body.length < 2 || body[0] !== '"' || body[body.length - 1] !== '"') return null;
  // A stray unescaped quote inside would end the literal before the text does; verifying the string closes only
  // at the very last character is what tells a real literal apart from text that merely starts and ends with `"`.
  let i = 1;
  let closedAt = -1;
  while (i < body.length) {
    if (body[i] === "\\") { i += 2; continue; }
    if (body[i] === '"') { closedAt = i; break; }
    i += 1;
  }
  if (closedAt !== body.length - 1) return null;
  return body.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * A statement's own construction expression, if it is one of this reader's
 * five known classes: `[[ClassName alloc] init...]` (nested brackets, the
 * shape every one of the five may use) or `[ClassName classMethod:...]` (a
 * class factory method, the shape `UIButton buttonWithType:` genuinely
 * needs, a construction with no `alloc`/`init` step at all). Returns the
 * class name and the variable the statement assigns it to, or null for
 * `variable` when the statement never assigns it to anything; a class this
 * reader does not know (`UIView`, `UIStackView`, a custom subclass) falls
 * through both patterns and is left for the caller to pass over.
 */
function detectConstruction(stmt) {
  const prefix = "(?:[A-Za-z_]\\w*\\s*\\*\\s*([A-Za-z_]\\w*)\\s*=\\s*)?";
  let m = new RegExp(`^${prefix}\\[\\s*\\[\\s*([A-Za-z_]\\w*)\\s+alloc\\s*\\]\\s*init\\w*\\b`).exec(stmt);
  if (m && KNOWN_CLASSES.includes(m[2])) return { className: m[2], variable: m[1] || null };
  m = new RegExp(`^${prefix}\\[\\s*([A-Za-z_]\\w*)\\s+[A-Za-z_]\\w*`).exec(stmt);
  if (m && KNOWN_CLASSES.includes(m[2])) return { className: m[2], variable: m[1] || null };
  return null;
}

/** One configuration statement matched against a variable this reader has already seen constructing something:
 * `.text`/`setText:`, `.secureTextEntry`/`setSecureTextEntry:`, `setTitle:forState:`, and
 * `addTarget:action:forControlEvents:`. Every shape needs only the variable it configures and the one argument
 * this reader's vocabulary reads for real; anything else about the call (a frame, an unrelated property) is not
 * this reader's concern. Returns null when the statement is not one of these five shapes at all. */
function detectConfiguration(stmt) {
  let m = /^([A-Za-z_]\w*)\.text\s*=\s*([\s\S]+)$/.exec(stmt);
  if (m) return { variable: m[1], kind: "text", value: m[2] };
  m = /^\[\s*([A-Za-z_]\w*)\s+setText:\s*([\s\S]+)\]$/.exec(stmt);
  if (m) return { variable: m[1], kind: "text", value: m[2] };

  m = /^([A-Za-z_]\w*)\.secureTextEntry\s*=\s*YES$/.exec(stmt);
  if (m) return { variable: m[1], kind: "secure" };
  m = /^\[\s*([A-Za-z_]\w*)\s+setSecureTextEntry:\s*YES\s*\]$/.exec(stmt);
  if (m) return { variable: m[1], kind: "secure" };

  m = /^\[\s*([A-Za-z_]\w*)\s+setTitle:\s*([\s\S]+?)\s+forState:\s*\w+\s*\]$/.exec(stmt);
  if (m) return { variable: m[1], kind: "title", value: m[2] };

  m = /^\[\s*([A-Za-z_]\w*)\s+addTarget:\s*self\s+action:\s*@selector\(\s*([A-Za-z_]\w*)\s*\)\s+forControlEvents:\s*\w+\s*\]$/.exec(stmt);
  if (m) return { variable: m[1], kind: "wiring", method: m[2] };

  return null;
}

/**
 * A whole `.m` file read into its construction-ordered controls, each with
 * whatever configuration this reader's vocabulary found for its own variable
 * (or none, when a control is never assigned to one at all), plus the
 * `@implementation`/`viewDidLoad` counts the caller uses to name a file this
 * reader does not attempt to split.
 */
export function parseUikit(source) {
  const clean = stripComments(String(source ?? ""));
  const implementations = (clean.match(/@implementation\b/g) || []).length;
  const viewDidLoads = (clean.match(/-\s*\(void\)\s*viewDidLoad\b/g) || []).length;
  const classMatch = /@implementation\s+([A-Za-z_]\w*)/.exec(clean);

  const statements = splitStatements(clean);

  const controls = [];
  const config = new Map();
  const ensure = (variable) => {
    if (!config.has(variable)) config.set(variable, { text: undefined, secure: false, title: undefined, wiredMethod: null });
    return config.get(variable);
  };

  for (const stmt of statements) {
    const ctor = detectConstruction(stmt);
    if (ctor) { controls.push(ctor); continue; }

    const cfg = detectConfiguration(stmt);
    if (!cfg) continue; // an addSubview: call, control flow, anything else outside this reader's own vocabulary
    const entry = ensure(cfg.variable);
    if (cfg.kind === "text") entry.text = parseObjcString(cfg.value);
    else if (cfg.kind === "secure") entry.secure = true;
    else if (cfg.kind === "title") entry.title = parseObjcString(cfg.value);
    else if (cfg.kind === "wiring") entry.wiredMethod = cfg.method;
  }

  const resolved = controls.map((c) => ({ ...c, config: c.variable ? config.get(c.variable) ?? null : null }));

  return {
    className: classMatch ? classMatch[1] : null,
    implementations,
    viewDidLoads,
    controls: resolved,
  };
}
