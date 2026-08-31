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
      async run({ log }) {
        const [major] = process.versions.node.split(".").map(Number);
        log.info(`\nnode ${process.versions.node} ${major >= 18 ? "(supported)" : "(portamp needs 18 or newer)"}\n`);
        for (const dep of OPTIONAL) {
          let state = "absent";
          try { await import(dep.name); state = "installed"; } catch { /* stays absent */ }
          log.info(`  ${dep.name.padEnd(18)} ${state}`);
          log.info(`    ${state === "installed" ? `enables ${dep.turnsOn}` : `without it, ${dep.without}`}`);
        }
        log.info("\nNothing above is required. The core has zero runtime dependencies, and that is a promise, not an accident.");
      },
    },
  },
};
