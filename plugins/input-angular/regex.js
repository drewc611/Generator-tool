/**
 * The fallback reader, used when typescript is not installed. It is the
 * original pass and it is honest about being approximate: the plugin records
 * an unverified note whenever this is the one that ran.
 */
export function readWithRegex(text, rel) {
  const screens = [];
  const calls = [];
  const interceptors = [];

  const component = text.match(/@Component\(\s*\{[\s\S]*?selector:\s*['"]([^'"]+)['"]/);
  if (component) {
    const inline = text.match(/template:\s*`([\s\S]*?)`/);
    const url = text.match(/templateUrl:\s*['"]([^'"]+)['"]/);
    screens.push({
      selector: component[1],
      className: text.match(/export\s+class\s+(\w+)/)?.[1] ?? null,
      file: rel,
      inputs: [...text.matchAll(/@Input\(\)\s+(\w+)/g)].map((m) => m[1]),
      outputs: [...text.matchAll(/@Output\(\)\s+(\w+)/g)].map((m) => m[1]),
      template: inline ? inline[1] : null,
      templateUrl: url ? url[1] : null,
    });
  }

  if (/@Injectable\(/.test(text) && /HttpClient/.test(text)) {
    for (const m of text.matchAll(/\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'"])([^`'"]+)\2/g)) {
      calls.push({
        method: m[1].toUpperCase(),
        path: m[3],
        file: rel,
        headers: null,
        body: ["get", "delete"].includes(m[1]) ? null : "unknown",
      });
    }
  }

  // Implementing the interface is what makes an interceptor. Merely importing
  // the type does not, and counting the import inflates the number on any file
  // that mentions it.
  for (const m of text.matchAll(/export\s+class\s+(\w+)\s+implements\s+[^{]*\bHttpInterceptor\b/g)) {
    interceptors.push({ file: rel, className: m[1] });
  }

  return { screens, calls, interceptors };
}
