import { mkdir, writeFile, access } from "node:fs/promises";
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
        const dir = join(process.cwd(), "plugins", name);
        if (await access(dir).then(() => true, () => false)) {
          log.error(`${dir} already exists. Scaffolding will not overwrite it.`);
          process.exitCode = 1;
          return;
        }
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "index.js"), PLUGIN(name, cls), "utf8");
        const testPath = join(process.cwd(), "test", `${name.replace(/^[a-z]+-/, "")}.test.js`);
        if (!(await access(testPath).then(() => true, () => false))) {
          await mkdir(dirname(testPath), { recursive: true });
          await writeFile(testPath, TEST(name), "utf8");
          log.info(`wrote plugins/${name}/index.js and test/${name.replace(/^[a-z]+-/, "")}.test.js`);
        } else {
          log.info(`wrote plugins/${name}/index.js (the test file already existed)`);
        }
        log.info("It loads on the next run; discovery needs no registration. Now make it honest.");
      },
    },
  },
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
    on("plan", async (ctx) => {
      log.debug("nothing to do yet");
    });
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
