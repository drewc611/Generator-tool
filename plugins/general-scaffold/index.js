import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * portamp new-plugin <class>-<subject>: the directory, the header contract and
 * the test stub, so a plugin starts from the conventions instead of from a
 * copy of whichever existing one was open at the time.
 */
const CLASSES = new Set(["input", "dsp", "output", "vis", "general"]);

export default {
  name: "general-scaffold",
  version: "0.1.0",
  class: "general",
  setup() {},
  commands: {
    "new-plugin": {
      describe: "scaffold plugins/<class>-<subject> with the contract in place",
      async run({ args, log }) {
        const name = args._[1];
        const [cls] = String(name ?? "").split("-");
        if (!name || !CLASSES.has(cls) || !/^[a-z]+-[a-z][a-z0-9-]*$/.test(name)) {
          log.error(`Usage: portamp new-plugin <class>-<subject>, where class is one of: ${[...CLASSES].join(", ")}`);
          process.exitCode = 1;
          return;
        }
        // Asking whether a file exists and then writing it is two answers to a
        // question that can change in between. The wx flag makes the write
        // itself the check.
        const dir = join(process.cwd(), "plugins", name);
        await mkdir(dir, { recursive: true });
        try {
          await writeFile(join(dir, "index.js"), PLUGIN(name, cls), { encoding: "utf8", flag: "wx" });
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
          log.error(`plugins/${name}/index.js already exists. Scaffolding will not overwrite it.`);
          process.exitCode = 1;
          return;
        }
        const testPath = join(process.cwd(), "test", `${name.replace(/^[a-z]+-/, "")}.test.js`);
        await mkdir(dirname(testPath), { recursive: true });
        try {
          await writeFile(testPath, TEST(name), { encoding: "utf8", flag: "wx" });
          log.info(`wrote plugins/${name}/index.js and test/${name.replace(/^[a-z]+-/, "")}.test.js`);
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
          log.info(`wrote plugins/${name}/index.js (the test file already existed)`);
        }
        log.info("It loads on the next run; discovery needs no registration. Now make it honest.");
      },
    },
  },
};

// Each class has a shape: the stage it belongs in, the part of the context it
// fills, and the mistake its kind of plugin usually makes. The stub starts
// from that shape instead of from a generic hook.
const BODIES = {
  input: `    on("extract", async (ctx) => {
      // Read the legacy source and push what it declares. A screen carries at
      // least: selector, className, file, template, templateOrigin, inputs,
      // outputs, rxjs (arrays may be empty), usesTwoWay, readBy.
      // ctx.screens.push({ ... });
      // ctx.api.calls.push({ method, path, file, headers: null, body: null });
      log.debug("nothing read yet");
    });`,
  dsp: `    on("plan", async (ctx) => {
      // Derive, never invent: read ctx.screens / ctx.api / ctx.sources,
      // measure something, and put the result on ctx under one new key.
      log.debug("nothing measured yet");
    });

    on("emit", async (ctx) => {
      // One report, named in caps: await ctx.write("REPORT.md", ...);
    });`,
  output: `    on("emit", async (ctx) => {
      // A target is turned on by naming it: portamp run --${"$"}{subject} true.
      // if (!ctx.config.${"$"}{subject}) return log.debug("not requested");
      // Never write a URL into a component; endpoints live in src/api/.
      log.debug("nothing emitted yet");
    });`,
  vis: `    on("verify", async (ctx) => {
      // Report what the run did, honestly: a claim the run cannot back
      // belongs in ctx.unverified(...), not in the report.
      log.debug("nothing to report yet");
    });`,
  general: `    on("scan", async (ctx) => {
      // Cross cutting concerns run first. A gate that fails should throw;
      // a gap that is survivable calls ctx.unverified(...) and continues.
      log.debug("nothing to check yet");
    });`,
};

const PLUGIN = (name, cls) => `/**
 * What this plugin knows that the core must not.
 *
 * The contract, before the code:
 * - Never guess. Anything undetermined calls ctx.unverified(...) and continues.
 * - No network without asking the policy object first.
 * - One log line per stage. The pipeline output stays readable.
 * - Optional dependencies are imported lazily, with a clear message when absent.
 */
export default {
  name: "${name}",
  version: "0.1.0",
  class: "${cls}",
  setup({ on, log, policy }) {
${(BODIES[cls] ?? BODIES.general).replaceAll("${subject}", name.split("-").slice(1).join("-"))}
  },
};
`;

const TEST = (name) => `import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/${name}/index.js";

test("${name} declares itself correctly", () => {
  assert.equal(plugin.name, "${name}");
  assert.ok(["input", "dsp", "output", "vis", "general"].includes(plugin.class));
});

// The real tests: for each thing this plugin claims, one test that proves it,
// and one that proves it refuses to guess when the claim cannot be met.
`;
