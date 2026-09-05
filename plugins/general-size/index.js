import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The port, weighed.
 *
 * A migration that trades a small legacy bundle for a large modern one has
 * regressed the thing users actually feel, and nobody notices until it ships,
 * because a component looks the same in review at any size. This measures what
 * the run wrote, by kind, and reports it. With `--max-kb` it becomes a budget:
 * the component code over the ceiling fails the run, the same shape as the
 * unverified ceiling, so a port cannot quietly get heavier.
 */

const KIND = [
  { kind: "components", re: /^src\/(features|qwik|preact|elements|solid|alpine)\// },
  { kind: "api client", re: /^src\/api\// },
  { kind: "tokens & styles", re: /^src\/(tokens|.*\.css$)|tokens\.modern/ },
  { kind: "host arrangement", re: /^(next|nuxt|remix|sveltekit)\/|(^|\/)serve\.js$/ },
  { kind: "tests", re: /(\.spec\.|\.test\.|tests?\/|conformance)/ },
  { kind: "reports", re: /\.(md|json|mmd|svg)$|^LEDGER|^\.portamp\// },
];

function classify(rel) {
  for (const k of KIND) if (k.re.test(rel)) return k.kind;
  return "other";
}

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

// Reports and tests do not ship, and reports include the run's own volatile
// files (run.json carries timestamps), so weighing them would make the total
// non deterministic. The port's weight is what it ships.
const SHIPS = (kind) => kind !== "reports" && kind !== "tests";

export async function weigh(written, outDir) {
  const groups = new Map();
  let total = 0;
  for (const rel of written) {
    const kind = classify(rel);
    if (!SHIPS(kind)) continue;
    const size = await stat(join(outDir, rel)).then((s) => s.size).catch(() => null);
    if (size == null) continue;
    if (!groups.has(kind)) groups.set(kind, { kind, files: 0, bytes: 0 });
    const g = groups.get(kind);
    g.files += 1;
    g.bytes += size;
    total += size;
  }
  const kinds = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  const componentBytes = groups.get("components")?.bytes ?? 0;
  const files = kinds.reduce((n, k) => n + k.files, 0);
  return { kinds, total, componentBytes, files };
}

export default {
  name: "general-size",
  version: "0.1.0",
  class: "general",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (ctx.config.dryRun) return log.debug("dry run wrote no bytes to weigh");
      const report = await weigh(ctx.written, ctx.config.out);
      ctx.size = report;
      // The CLI stores --max-kb under its kebab key; a config object or a test
      // passes the camelCase one. Read both, the way the unverified ceiling does.
      const budget = ctx.config.maxKb ?? ctx.config["max-kb"];
      await ctx.write("SIZE.md", render(report, budget));
      log.info(`the port weighs ${kb(report.total)} KB across ${report.files} file(s), ${kb(report.componentBytes)} KB of components`);

      const max = Number(budget);
      if (Number.isFinite(max) && kb(report.componentBytes) > max) {
        throw new Error(
          `the component code is ${kb(report.componentBytes)} KB, over the --max-kb ceiling of ${max} KB. ` +
          `Lift shared blocks with --components, or raise the ceiling on purpose. SIZE.md has the breakdown.`
        );
      }
    });
  },
};

function render(report, maxKb) {
  const rows = report.kinds.map((k) =>
    `| ${k.kind} | ${k.files} | ${kb(k.bytes)} KB | ${Math.round((k.bytes / report.total) * 100)}% |`);
  const ceiling = Number(maxKb);

  return `# The port, weighed

What the run wrote, by kind. A migration that trades a small legacy bundle
for a large modern one regresses the thing users feel; this is the number
review cannot see. It counts source bytes on disk, not a built and minified
bundle, so read it as proportion and trend rather than a wire weight.

| kind | files | size | share |
| --- | --- | --- | --- |
${rows.join("\n")}
| **total** | **${report.files}** | **${kb(report.total)} KB** | 100% |

Component code: **${kb(report.componentBytes)} KB**.${Number.isFinite(ceiling) ? ` Budget: ${ceiling} KB (\`--max-kb\`).` : " Set `--max-kb` to hold it to a budget the run enforces."}

---

The number to watch is the component share: reports and tests do not ship,
but every kilobyte of component code does. When it grows, \`--components\`
lifts the blocks more than one screen repeats into one, which is the cheapest
weight a port can lose.
`;
}
