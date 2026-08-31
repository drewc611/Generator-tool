/**
 * Printing into a target language, safely.
 *
 * Every printer builds source code out of values it read from somebody else's
 * app, so the rules for putting a value into a string literal are the same for
 * all of them and they live here rather than four times over.
 *
 * `JSON.stringify` looks like it does this job and does not quite:
 *
 *   - It leaves `<` alone. A class name containing `</script>` ends the script
 *     element the moment anybody inlines the emitted module into a page, which
 *     turns a value in the old app into markup in the new one.
 *   - It leaves U+2028 and U+2029 as themselves. Since ES2019 they are legal
 *     inside a string literal, so a current engine parses them, but anything
 *     older treats them as line terminators and the literal ends early.
 */
export function jsString(value) {
  return JSON.stringify(value === undefined ? "" : String(value))
    .replace(/</g, "\\x3C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * A value that has to be a name in the emitted code rather than a string.
 *
 * A selector is not required to be a legal identifier, and one that is not
 * produces a file that does not parse, so it is corrected here rather than
 * discovered by whoever runs the build.
 */
export function identifier(name, fallback = "Screen") {
  const cleaned = String(name ?? "").replace(/[^\w$]/g, "");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : cleaned ? `_${cleaned}` : fallback;
}

/**
 * A single quoted string, for the targets that put an expression inside a
 * double quoted attribute. The backslash has to be escaped before the quote is,
 * or the escape the second pass adds is itself escaped by the first.
 */
export function singleQuoted(value) {
  return `'${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/</g, "\\x3C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}'`;
}
