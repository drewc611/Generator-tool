/**
 * The TypeScript compiler API pass. Reads the same things the regular
 * expression pass reads, from the syntax tree instead of from the text, so a
 * decorator spread over six lines or a selector holding a brace is not a miss.
 *
 * typescript is an optional dependency. When it is absent this module reports
 * that and the plugin falls back, because a missing optional dependency should
 * degrade the read, not end the run.
 */

let cached;

// The API this pass needs. typescript 7 ships a different entry point that
// exposes only the version, so importing successfully is not the same as
// getting a compiler, and the difference has to be caught here rather than
// halfway through a run.
const REQUIRED = ["createSourceFile", "forEachChild", "isClassDeclaration", "isCallExpression"];

export function isUsable(ts) {
  return Boolean(ts) && REQUIRED.every((name) => typeof ts[name] === "function") && Boolean(ts.ScriptTarget);
}

export async function loadTypeScript() {
  if (cached !== undefined) return cached;
  let mod;
  try {
    mod = await import("typescript");
  } catch {
    cached = null;
    return cached;
  }
  const candidate = mod.default ?? mod;
  cached = isUsable(candidate) ? candidate : (isUsable(mod) ? mod : null);
  if (!cached) {
    const version = mod.version ?? candidate?.version ?? "unknown";
    cached = null;
    loadTypeScript.unusable = version;
  }
  return cached;
}

// TypeScript moved decorators off the node in 4.8. Support both shapes so the
// plugin works against whatever version the project already has.
function decoratorsOf(ts, node) {
  if (typeof ts.getDecorators === "function" && ts.canHaveDecorators?.(node)) {
    return ts.getDecorators(node) ?? [];
  }
  return node.decorators ?? [];
}

function decoratorName(ts, decorator) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) return expression.expression.getText();
  return expression.getText();
}

function decoratorArgument(ts, decorator, index = 0) {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression.arguments[index] : undefined;
}

function literalText(ts, node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function objectProperty(ts, object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer;
    }
  }
  return undefined;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Which properties on this class hold an HttpClient. A call on some other
 * property that happens to be named `http` belongs to somebody else's object.
 */
function httpClientProperties(ts, classNode) {
  const names = new Set();
  for (const member of classNode.members) {
    if (ts.isConstructorDeclaration(member)) {
      for (const parameter of member.parameters) {
        if (parameter.type?.getText() === "HttpClient") names.add(parameter.name.getText());
      }
    }
    if (ts.isPropertyDeclaration(member) && member.type?.getText() === "HttpClient") {
      names.add(member.name.getText());
    }
  }
  return names;
}

function urlOf(ts, node) {
  if (!node) return null;
  const direct = literalText(ts, node);
  if (direct !== null) return direct;
  if (ts.isTemplateExpression(node)) {
    // `${this.base}/orders/${id}` keeps its shape so a reader can see what is
    // interpolated. Resolving it would be a guess.
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += `\${${span.expression.getText()}}${span.literal.text}`;
    }
    return out;
  }
  return null;
}

export function readSourceFile(ts, text, rel) {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const screens = [];
  const calls = [];
  const interceptors = [];

  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      const decorators = decoratorsOf(ts, node);
      const component = decorators.find((d) => decoratorName(ts, d) === "Component");

      if (component) {
        const options = decoratorArgument(ts, component);
        const inputs = [];
        const outputs = [];
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member)) continue;
          for (const decorator of decoratorsOf(ts, member)) {
            const name = decoratorName(ts, decorator);
            if (name === "Input") inputs.push(member.name.getText());
            if (name === "Output") outputs.push(member.name.getText());
          }
        }
        screens.push({
          selector: literalText(ts, objectProperty(ts, options, "selector")),
          className: node.name?.getText() ?? null,
          file: rel,
          inputs,
          outputs,
          template: literalText(ts, objectProperty(ts, options, "template")),
          templateUrl: literalText(ts, objectProperty(ts, options, "templateUrl")),
        });
      }

      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
        if (clause.types.some((t) => t.expression.getText() === "HttpInterceptor")) {
          interceptors.push({ file: rel, className: node.name?.getText() ?? null });
        }
      }

      const clients = httpClientProperties(ts, node);
      if (clients.size) {
        const findCalls = (inner) => {
          if (
            ts.isCallExpression(inner) &&
            ts.isPropertyAccessExpression(inner.expression) &&
            HTTP_METHODS.has(inner.expression.name.getText())
          ) {
            const receiver = inner.expression.expression.getText().replace(/^this\./, "");
            if (clients.has(receiver)) {
              const method = inner.expression.name.getText();
              const path = urlOf(ts, inner.arguments[0]);
              if (path !== null) {
                calls.push({
                  method: method.toUpperCase(),
                  path,
                  file: rel,
                  headers: null,
                  body: ["get", "delete", "head", "options"].includes(method) ? null : "unknown",
                });
              }
            }
          }
          ts.forEachChild(inner, findCalls);
        };
        ts.forEachChild(node, findCalls);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return { screens, calls, interceptors };
}
