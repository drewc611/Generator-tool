#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { Kernel } from "./core/kernel.js";
import { Policy, PolicyViolation } from "./core/policy.js";
import { createLogger, createContext } from "./core/context.js";

const here = dirname(fileURLToPath(import.meta.url));
const BUILTIN = resolve(here, "../plugins");

const HELP = `
portamp  port a legacy front end, without losing the look or the API contract

usage
  portamp run [options]        run the pipeline
  portamp plugins              list what is loaded
  portamp init                 write a starter portamp.config.js
  portamp ui                   serve the last run at 127.0.0.1:4321

options
  --src <dir>          legacy source tree            (default ./legacy)
  --shots <dir>        screenshots of the old app    (default ./screenshots)
  --artifacts <dir>    HAR, schema dumps, exports    (default ./artifacts)
  --out <dir>          where the port is written     (default ./out)
  --only <names>       comma separated plugin names to run
  --skip <names>       comma separated plugin names to leave out
  --dry-run            run everything, write nothing; report what would land
  --offline            refuse all live calls, outranking --allow-live
  --trace <file>       write plugin timings as a chrome trace after the run
  --allow-live         permit calls to real systems  (off by default)
  --allow-billable     permit calls that charge per request
  --json               with the plugins command, print the roster as JSON
      --port <n>       port for the ui command      (default 4321)
      --fresh          make ui run the pipeline again
  -v, --verbose        show plugin timings
  -q, --quiet          errors only
  -h, --help

plugin options
  Any option the core does not recognise is passed to the plugins untouched,
  so a target is turned on by naming it. Run "portamp plugins" to see what is
  loaded, and read each plugin's header for the option it answers to.

no source available
  Put a HAR, a schema dump, or report exports in ./artifacts, or configure
  record in portamp.config.js to drive the running app with Playwright.
  Both paths require portamp.authorization.json naming who owns the system.

policy
  Live calls are off unless you ask for them. Credentials found in the legacy
  source stop the run and are never copied into the port or printed.
`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-h" || t === "--help") a.help = true;
    else if (t === "--version") a.version = true;
    else if (t === "-v" || t === "--verbose") a.verbose = true;
    else if (t === "-q" || t === "--quiet") a.quiet = true;
    else if (t === "--allow-live") a.allowLive = true;
    else if (t === "--allow-billable") a.allowBillable = true;
    else if (t === "--fresh") a.fresh = true;
    else if (t === "--json") a.json = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--offline") a.offline = true;
    else if (t.startsWith("--")) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

async function loadConfig(cwd) {
  const p = join(cwd, "portamp.config.js");
  try {
    await access(p);
    const mod = await import(`file://${p}`);
    return mod.default ?? {};
  } catch {
    return {};
  }
}

const CONFIG_TEMPLATE = `export default {
  src: "./legacy",
  shots: "./screenshots",
  out: "./out",

  // Anything in ./plugins is picked up automatically. List extra ones here.
  plugins: [],

  // Emitted design tokens override whatever the extractor infers.
  tokens: {},

  // Off by default. Turning these on is a statement that you are authorized.
  allowLive: false,
  allowBillable: false,
};
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "run";
  if (args.help || cmd === "help") return process.stdout.write(HELP);

  const log = createLogger({ verbose: args.verbose, quiet: args.quiet });
  const cwd = process.cwd();

  if (cmd === "version" || args.version) {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(join(here, "..", "package.json"), "utf8"));
    return process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  }

  if (cmd === "init") {
    const { writeFile } = await import("node:fs/promises");
    // wx: a config somebody edited is not a thing to silently replace.
    try {
      await writeFile(join(cwd, "portamp.config.js"), CONFIG_TEMPLATE, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if (err.code === "EEXIST") {
        log.error("portamp.config.js already exists. init will not overwrite it; edit it, or move it aside first.");
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    return log.info("wrote portamp.config.js");
  }

  const fileConfig = await loadConfig(cwd);

  // An option the core does not recognise belongs to a plugin, so it is passed
  // through rather than rejected. The core still learns nothing: it does not
  // know which plugin asked for it, or that any plugin did.
  const { _: _positional, ...flags } = args;

  const config = {
    // Everything from the config file passes through untouched, so a plugin
    // can read its own settings without the core learning that it exists. The
    // keys below are the ones the core itself resolves to absolute paths.
    ...fileConfig,
    ...flags,
    src: resolve(cwd, args.src || fileConfig.src || "./legacy"),
    shots: resolve(cwd, args.shots || fileConfig.shots || "./screenshots"),
    out: resolve(cwd, args.out || fileConfig.out || "./out"),
    tokens: fileConfig.tokens || {},
    artifacts: resolve(cwd, args.artifacts || fileConfig.artifacts || "./artifacts"),
    record: fileConfig.record || null,
    only: args.only ? args.only.split(",").map((s) => s.trim()) : null,
    skip: args.skip ? args.skip.split(",").map((s) => s.trim()) : null,
    dryRun: args.dryRun ?? fileConfig.dryRun ?? false,
  };

  // The attestation may scope live calls to the domains it names. Read here
  // because the policy object is immutable once built; the plugin that
  // validates the attestation's content still runs at scan.
  let allowedDomains = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const att = JSON.parse(await readFile(join(cwd, "portamp.authorization.json"), "utf8"));
    if (Array.isArray(att.domains)) allowedDomains = att.domains;
  } catch { /* no attestation, no domain scope */ }

  const policy = new Policy({
    allowLive: args.allowLive ?? fileConfig.allowLive ?? false,
    allowBillable: args.allowBillable ?? fileConfig.allowBillable ?? false,
    allowedDomains,
    offline: args.offline ?? fileConfig.offline ?? false,
    log,
  });

  const kernel = new Kernel({ log, policy });
  await kernel.discover({
    builtinDir: BUILTIN,
    projectDir: join(cwd, "plugins"),
    extra: fileConfig.plugins || [],
  });

  // A command a plugin registered. The core dispatches it without knowing what
  // it is, the same way it dispatches a stage.
  const command = kernel.commands.get(cmd);
  if (command) {
    return command.run({
      config, log, policy, args,
      runPipeline: async () => {
        const ctx = createContext({ config, log, policy });
        await kernel.run(ctx);
        return ctx;
      },
    });
  }

  if (cmd === "plugins") {
    if (args.json) {
      // For tooling. The shape is the roster and nothing else the core knows.
      return process.stdout.write(JSON.stringify({
        plugins: kernel.plugins.map((p) => ({ name: p.name, class: p.class, version: p.version })),
        commands: [...kernel.commands].map(([name, spec]) => ({ name, describe: spec.describe ?? null, plugin: spec.plugin })),
      }, null, 2) + "\n");
    }
    log.info(`\n${kernel.plugins.length} plugin(s)\n`);
    for (const p of kernel.plugins)
      log.info(`  ${p.class.padEnd(8)} ${p.name.padEnd(24)} ${p.version}`);
    if (kernel.commands.size) {
      log.info(`\n${kernel.commands.size} command(s) from plugins\n`);
      for (const [name, spec] of kernel.commands)
        log.info(`  portamp ${name.padEnd(22)} ${spec.describe ?? ""}  (${spec.plugin})`);
    }
    return;
  }

  if (config.only)
    kernel.bus.forEach((subs, stage) =>
      kernel.bus.set(
        stage,
        subs.filter((s) => config.only.includes(s.meta.name))
      )
    );

  // The complement of --only, for leaving one plugin out of a run without
  // naming the other eighty. Names are opaque strings to the core either way.
  if (config.skip)
    kernel.bus.forEach((subs, stage) =>
      kernel.bus.set(
        stage,
        subs.filter((s) => !config.skip.includes(s.meta.name))
      )
    );

  const ctx = createContext({ config, log, policy });
  try {
    await kernel.run(ctx);

    // The run as a chrome trace, loadable in about://tracing or Perfetto.
    // Timings are the kernel's own; the core still knows nothing about what
    // any plugin did with its milliseconds.
    if (args.trace) {
      const { writeFile } = await import("node:fs/promises");
      let ts = 0;
      const events = (ctx.timings ?? []).map((t) => {
        const event = { name: t.name, cat: t.stage, ph: "X", ts: ts * 1000, dur: t.ms * 1000, pid: 1, tid: 1 };
        ts += t.ms;
        return event;
      });
      await writeFile(resolve(cwd, args.trace), JSON.stringify({ traceEvents: events }, null, 2), "utf8");
      log.info(`trace written to ${args.trace}`);
    }

    log.info(
      config.dryRun
        ? `\ndry run  ${ctx.written.length} file(s) would be written to ${config.out}; none were` +
          (ctx.report.unverified.length ? `\n         ${ctx.report.unverified.length} item(s) would be in PORT_NOTES.md` : "")
        : `\ndone  ${ctx.written.length} file(s) written to ${config.out}` +
          (ctx.report.unverified.length
            ? `\n      ${ctx.report.unverified.length} item(s) could not be verified, see PORT_NOTES.md`
            : "")
    );
  } catch (err) {
    if (err instanceof PolicyViolation) {
      log.error(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

main().catch((e) => {
  process.stderr.write(`\x1b[31merror \x1b[0m${e.stack || e.message}\n`);
  process.exitCode = 1;
});
