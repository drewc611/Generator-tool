/**
 * A CI workflow for the port itself. The emitted code has no build step on
 * purpose, so its CI is the checks that need none: every JS file parses,
 * every JSON file is JSON, and no emitted component carries a URL, which is
 * the same endpoint rule portamp enforces at write time, kept enforced after
 * the files leave portamp's hands.
 */

export function workflow(written) {
  const hasFeatures = written.some((f) => f.startsWith("src/features/"));
  const hasStatesSuite = written.includes("tests/states.test.js");
  return `# Written by portamp for the ported code in this directory.
# The port has no build step, so CI is what needs none.
name: port checks
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: every JS file parses
        run: |
          echo '{"type":"module"}' > package.json
          find src -name '*.js' -print0 | xargs -0 -r -n1 node --check
      - name: every JSON file is JSON
        run: |
          find . -name '*.json' -not -path './node_modules/*' -print0 | \\
            xargs -0 -r -n1 node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))'
${hasFeatures ? `      - name: no component carries a URL
        run: |
          if grep -rn "https\\?://" src/features/ --include='*.jsx'; then
            echo "endpoints live in src/api/endpoints.js and nowhere else" >&2
            exit 1
          fi
` : ""}${hasStatesSuite ? `      - name: every component keeps its four states
        run: node --test tests/states.test.js
` : ""}`;
}

export default {
  name: "output-ci",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.config.portci) return log.debug("not requested");
      if (!ctx.written.length) return log.debug("nothing to check");
      await ctx.write(".github/workflows/port.yml", workflow(ctx.written));
      log.info("port CI workflow written");
    });
  },
};
