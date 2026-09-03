/**
 * portamp doctor: what is installed, what is optional and absent, and what
 * each absence turns off. The tool degrades on purpose; this makes the
 * degradation visible before a run is missing something and nobody knows why.
 */
const OPTIONAL = [
  { name: "typescript", turnsOn: "the syntax tree pass in input-angular", without: "the regex fallback reads the app, more narrowly, and says so" },
  { name: "playwright", turnsOn: "input-record and input-explore against a live app", without: "recordings and explorations can only be replayed from files" },
  { name: "@playwright/test", turnsOn: "running the emitted conformance suite (vis-equivalence)", without: "the suite is emitted but nothing executes it" },
];

export default {
  name: "general-doctor",
  version: "0.1.0",
  class: "general",
  setup() {},
  commands: {
    doctor: {
      describe: "what is installed, and what each gap turns off",
      async run({ config, log }) {
        const [major] = process.versions.node.split(".").map(Number);
        log.info(`\nnode ${process.versions.node} ${major >= 18 ? "(supported)" : "(portamp needs 18 or newer)"}\n`);
        for (const dep of OPTIONAL) {
          let state = "absent";
          // The version says which one answers, because "installed" hides
          // exactly the mismatch a doctor exists to catch.
          try {
            await import(dep.name);
            state = "installed";
            const { readFile } = await import("node:fs/promises");
            const { createRequire } = await import("node:module");
            try {
              const pkg = createRequire(import.meta.url).resolve(`${dep.name}/package.json`);
              state = `installed ${JSON.parse(await readFile(pkg, "utf8")).version}`;
            } catch { /* importable but its package.json is not; installed stands */ }
          } catch { /* stays absent */ }
          log.info(`  ${dep.name.padEnd(18)} ${state}`);
          log.info(`    ${state.startsWith("installed") ? `enables ${dep.turnsOn}` : `without it, ${dep.without}`}`);
        }

        // The out directory has to accept writes before a run is worth
        // starting; discovering that at emit costs the whole pipeline first.
        if (config?.out) {
          const { mkdir, writeFile, rm } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const probe = join(config.out, ".portamp-doctor-probe");
          try {
            await mkdir(config.out, { recursive: true });
            await writeFile(probe, "probe", "utf8");
            await rm(probe);
            log.info(`  out directory       writable (${config.out})`);
          } catch (err) {
            log.info(`  out directory       NOT WRITABLE (${config.out}): ${err.code ?? err.message}`);
          }
        }
        // playwright without a browser binary fails at run time, not install
        // time, which is exactly when nobody wants to learn it.
        try {
          const pw = await import("playwright");
          const path = pw.chromium?.executablePath?.();
          const { access } = await import("node:fs/promises");
          if (path) {
            await access(path).then(
              () => log.info(`  chromium            present at ${path}`),
              () => log.info(`  chromium            MISSING: playwright is installed but its browser is not. Run: npx playwright install chromium`)
            );
          }
        } catch { /* playwright absent; already reported above */ }
        log.info("\nNothing above is required. The core has zero runtime dependencies, and that is a promise, not an accident.");
      },
    },
    explain: {
      describe: "which plugin wrote a file, and at which stage",
      async run({ args, config, log }) {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const target = args._[1];
        if (!target) {
          log.error("Usage: portamp explain <file as listed in the run, e.g. PORT_NOTES.md>");
          process.exitCode = 1;
          return;
        }
        let run;
        try {
          run = JSON.parse(await readFile(join(config.out, ".portamp", "run.json"), "utf8"));
        } catch {
          log.error(`No run recorded under ${config.out}. Run the pipeline first; explain reads its record.`);
          process.exitCode = 1;
          return;
        }
        const hit = run.provenance?.[target] ?? Object.entries(run.provenance ?? {}).find(([f]) => f.endsWith(target))?.[1];
        if (!hit) {
          const known = Object.keys(run.provenance ?? {});
          log.error(`Nothing in the last run wrote ${target}.${known.length ? ` It wrote: ${known.join(", ")}` : ""}`);
          process.exitCode = 1;
          return;
        }
        log.info(`${target} was written by ${hit.plugin} at the ${hit.stage} stage.`);
        const said = run.plugins?.find((p) => p.name === hit.plugin)?.contributed;
        if (said) log.info(`In that run it reported: ${said}`);
      },
    },
  },
};
