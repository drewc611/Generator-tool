/**
 * A small, honest arithmetic and one-variable linear equation solver. It
 * proves an answer with real steps rather than asserting one: every result
 * comes from evaluating the expression the person actually typed, and
 * anything past what this file can prove linear (a second variable, a
 * squared term, a variable used as a divisor, no variable at all in an
 * equation) is refused by name rather than approximated, the same restraint
 * every reader in this tool keeps over an expression it cannot fully
 * resolve. No network call, no model, nothing but this file's own
 * arithmetic; the same offline, zero dependency shape vis-transformer
 * already keeps for its own pure math.
 */

class SolveError extends Error {}

/** A number, an identifier, or one of ()+-*\/^= as its own token; whitespace is dropped between them. */
function tokenize(text) {
  const tokens = [];
  const re = /\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/^=])/g;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m || m.index !== at) {
      const rest = text.slice(at).trim();
      if (!rest) break;
      throw new SolveError(`"${rest[0]}" is not a character this reader understands`);
    }
    tokens.push(m[1]);
    at = re.lastIndex;
  }
  return tokens;
}

/**
 * Recursive descent over one side of an equation (or a whole plain
 * expression): expr := term (('+'|'-') term)*, term := power (('*'|'/')
 * power)*, power := unary ('^' power)?  (right associative), unary :=
 * ('-'|'+')? primary, primary := NUMBER | IDENT | '(' expr ')'.
 */
function parseSide(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function primary() {
    const t = next();
    if (t === undefined) throw new SolveError("an expression ended where a number or a name was expected");
    if (t === "(") {
      const inner = expr();
      if (next() !== ")") throw new SolveError("a \"(\" was never closed with a \")\"");
      return inner;
    }
    if (/^[0-9]/.test(t)) return { type: "num", value: Number(t) };
    if (/^[A-Za-z_]/.test(t)) return { type: "var", name: t };
    throw new SolveError(`"${t}" was not expected there`);
  }

  function unary() {
    if (peek() === "-") { next(); return { type: "neg", value: unary() }; }
    if (peek() === "+") { next(); return unary(); }
    return power();
  }

  function power() {
    const base = primary();
    if (peek() === "^") { next(); return { type: "bin", op: "^", left: base, right: power() }; }
    return base;
  }

  // "2x" and "2(3+4)" write a multiplication with no operator between the
  // two factors at all; a number, a name or an open paren can each start a
  // new factor, so meeting one right after a complete factor is read the
  // same as an explicit "*" between them, the ordinary reading of algebra
  // notation rather than a guess about what the missing operator was.
  const startsFactor = (t) => t !== undefined && (/^[0-9A-Za-z_(]/.test(t));

  function term() {
    let node = unary();
    while (peek() === "*" || peek() === "/" || startsFactor(peek())) {
      const op = peek() === "*" || peek() === "/" ? next() : "*";
      node = { type: "bin", op, left: node, right: unary() };
    }
    return node;
  }

  function expr() {
    let node = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      node = { type: "bin", op, left: node, right: term() };
    }
    return node;
  }

  const ast = expr();
  if (i !== tokens.length) throw new SolveError(`"${tokens.slice(i).join(" ")}" was left over after a complete expression`);
  return ast;
}

/** A pure number this expression evaluates to; a variable anywhere in it is a real gap, not a value to guess at. */
function evalNumeric(node) {
  switch (node.type) {
    case "num": return node.value;
    case "var": throw new SolveError(`this is not a plain expression: it names a variable ("${node.name}"); write it as an equation with = to solve for it`);
    case "neg": return -evalNumeric(node.value);
    case "bin": {
      const l = evalNumeric(node.left), r = evalNumeric(node.right);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") { if (r === 0) throw new SolveError("division by zero"); return l / r; }
      if (node.op === "^") return Math.pow(l, r);
      throw new SolveError(`unknown operator "${node.op}"`);
    }
    default: throw new SolveError("an expression shape this reader does not evaluate");
  }
}

/**
 * This side reduced to coeff*x + constant, x being the one named variable;
 * a term that multiplies or divides two variable-carrying parts, or raises
 * one to anything but a plain number, is not linear and is refused rather
 * than partly reproduced.
 */
function evalLinear(node, varName) {
  switch (node.type) {
    case "num": return { coeff: 0, constant: node.value };
    case "var":
      if (node.name !== varName) throw new SolveError(`this reader solves for one variable only ("${varName}"); "${node.name}" is a second one`);
      return { coeff: 1, constant: 0 };
    case "neg": {
      const v = evalLinear(node.value, varName);
      return { coeff: -v.coeff, constant: -v.constant };
    }
    case "bin": {
      if (node.op === "+" || node.op === "-") {
        const l = evalLinear(node.left, varName), r = evalLinear(node.right, varName);
        return node.op === "+"
          ? { coeff: l.coeff + r.coeff, constant: l.constant + r.constant }
          : { coeff: l.coeff - r.coeff, constant: l.constant - r.constant };
      }
      if (node.op === "*") {
        const l = evalLinear(node.left, varName), r = evalLinear(node.right, varName);
        if (l.coeff !== 0 && r.coeff !== 0) throw new SolveError(`"${varName}" multiplied by itself is not linear; this reader does not solve it`);
        return l.coeff === 0
          ? { coeff: l.constant * r.coeff, constant: l.constant * r.constant }
          : { coeff: r.constant * l.coeff, constant: r.constant * l.constant };
      }
      if (node.op === "/") {
        const l = evalLinear(node.left, varName), r = evalLinear(node.right, varName);
        if (r.coeff !== 0) throw new SolveError(`dividing by "${varName}" is not linear; this reader does not solve it`);
        if (r.constant === 0) throw new SolveError("division by zero");
        return { coeff: l.coeff / r.constant, constant: l.constant / r.constant };
      }
      if (node.op === "^") {
        const l = evalLinear(node.left, varName), r = evalLinear(node.right, varName);
        if (r.coeff !== 0) throw new SolveError(`"${varName}" in an exponent is not linear; this reader does not solve it`);
        if (l.coeff !== 0 && r.constant !== 1) throw new SolveError(`"${varName}" raised to a power other than 1 is not linear; this reader does not solve it`);
        if (l.coeff === 0) return { coeff: 0, constant: Math.pow(l.constant, r.constant) };
        return l; // x^1
      }
      throw new SolveError(`unknown operator "${node.op}"`);
    }
    default: throw new SolveError("an expression shape this reader does not evaluate");
  }
}

/** Every distinct identifier named anywhere in the tokens, in first-seen order. */
function identifiersOf(tokens) {
  const seen = [];
  for (const t of tokens) if (/^[A-Za-z_]/.test(t) && !seen.includes(t)) seen.push(t);
  return seen;
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e9) / 1e9));

/** A plain expression with no variable: a number, and the steps are just the one evaluation. */
export function solveExpression(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, error: "nothing was typed" };
  try {
    const tokens = tokenize(raw);
    const ids = identifiersOf(tokens);
    if (ids.length) return { ok: false, error: `"${raw}" names a variable ("${ids[0]}"); write it as an equation with = to solve for it` };
    const ast = parseSide(tokens);
    const value = evalNumeric(ast);
    return { ok: true, input: raw, value: fmt(value), steps: [`${raw} = ${fmt(value)}`] };
  } catch (err) {
    if (err instanceof SolveError) return { ok: false, error: err.message };
    throw err;
  }
}

/** An equation, exactly one "=", exactly one named variable across both sides; anything else is a named refusal. */
export function solveEquation(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, error: "nothing was typed" };
  const sides = raw.split("=");
  if (sides.length !== 2) return { ok: false, error: `an equation needs exactly one "="; this has ${sides.length - 1}` };
  try {
    const leftTokens = tokenize(sides[0]);
    const rightTokens = tokenize(sides[1]);
    const ids = identifiersOf([...leftTokens, ...rightTokens]);
    if (ids.length === 0) return { ok: false, error: "no variable appears in this equation; there is nothing to solve for" };
    if (ids.length > 1) return { ok: false, error: `this reader solves for one variable only; "${ids.join(", ")}" are ${ids.length}` };
    const varName = ids[0];
    const left = evalLinear(parseSide(leftTokens), varName);
    const right = evalLinear(parseSide(rightTokens), varName);
    const coeff = left.coeff - right.coeff;
    const constant = left.constant - right.constant;
    const steps = [`${sides[0].trim()} = ${sides[1].trim()}`, `${fmt(coeff)}${varName} + ${fmt(constant)} = 0`];
    if (coeff === 0) {
      if (constant === 0) return { ok: true, input: raw, variable: varName, value: null, steps: [...steps, "every value satisfies this: it is an identity"], identity: true };
      return { ok: false, error: `"${raw}" has no solution: it reduces to ${fmt(constant)} = 0, which is false for every ${varName}` };
    }
    const value = -constant / coeff;
    steps.push(`${varName} = ${fmt(-constant)} / ${fmt(coeff)}`, `${varName} = ${fmt(value)}`);
    return { ok: true, input: raw, variable: varName, value: fmt(value), steps };
  } catch (err) {
    if (err instanceof SolveError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Either kind, chosen by whether an "=" is present; the one entry point the console's own route and the plugin's demonstration both call. */
export function solve(text) {
  return String(text ?? "").includes("=") ? solveEquation(text) : solveExpression(text);
}
