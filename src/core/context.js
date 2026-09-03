import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

export function createLogger({ verbose = false, quiet = false } = {}) {
  const out = (s) => !quiet && process.stdout.write(s + "\n");
  // What each plugin said about itself, kept so it can be attributed later.
  const transcript = [];
  const base = {
    transcript,
    info: (m) => out(m),
    warn: (m) => out(C.amber("warn  ") + m),
    error: (m) => process.stderr.write(C.red("error ") + m + "\n"),
    debug: (m) => verbose && out(C.dim("debug " + m)),
    stage: (name, n) => out(C.cyan(`\n${name}`) + C.dim(`  ${n} plugin(s)`)),
    child(prefix) {
      return {
        ...base,
        info: (m) => {
          transcript.push({ plugin: prefix, message: m });
          out(C.dim(`[${prefix}] `) + m);
        },
        warn: (m) => out(C.amber("warn  ") + C.dim(`[${prefix}] `) + m),
        debug: (m) => verbose && out(C.dim(`debug [${prefix}] ${m}`)),
      };
    },
  };
  return base;
}

/**
 * One object passed through every stage. Plugins read what earlier stages put
 * here and add their own. Keeping it flat and boring is deliberate: a plugin
 * author should be able to guess the shape.
 */
export function createContext({ config, log, policy }) {
  return {
    config,
    log,
    policy,

    // set by general-authorization when an attestation is on disk
    authorization: null,

    // filled by input plugins
    sources: { files: [], screenshots: [], specs: [], observedStyles: [] },

    // filled by dsp plugins
    tokens: null,
    screens: [],
    api: { calls: [], interceptors: [] },
    plan: { components: [], notes: [] },

    // filled by output plugins
    written: [],

    // filled by the kernel as each hook runs
    timings: [],

    // filled by vis plugins
    report: { parity: [], unverified: [] },

    async write(relPath, contents) {
      const full = join(config.out, relPath);
      // A dry run records every write and performs none. The pipeline, the
      // gates and the summary all behave as if the files landed, which is
      // the point: the answer to "what would this run do" with nothing done.
      if (!config.dryRun) {
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents, "utf8");
      }
      this.written.push(relPath);
      return full;
    },

    note(text) {
      this.plan.notes.push(text);
    },

    unverified(text) {
      this.report.unverified.push(text);
    },
  };
}
