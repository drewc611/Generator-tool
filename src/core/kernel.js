import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The kernel is deliberately small. It knows five plugin classes, five pipeline
 * stages, and nothing about Angular, React, screenshots, or HTTP. Everything
 * that knows a framework is a plugin, which is the whole point.
 *
 *   input    read something (source tree, screenshots, OpenAPI spec)
 *   dsp      transform what was read (tokens, api contract, component plan)
 *   output   emit files (React, Storybook, a report)
 *   vis      show the result (parity view, diff, served preview)
 *   general  cross cutting gates (policy, secret scan, license check)
 */

export const CLASSES = ["input", "dsp", "output", "vis", "general"];
export const STAGES = ["scan", "extract", "plan", "emit", "verify"];

export class Kernel {
  constructor({ log, policy }) {
    this.plugins = [];
    this.log = log;
    this.policy = policy;
    this.bus = new Map();
  }

  /** Plugins subscribe to stages; the kernel never calls a plugin directly. */
  on(stage, fn, meta) {
    if (!STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
    if (!this.bus.has(stage)) this.bus.set(stage, []);
    this.bus.get(stage).push({ fn, meta });
  }

  register(plugin) {
    const { name, version, class: cls, setup } = plugin;
    if (!name) throw new Error("Plugin is missing a name.");
    if (!CLASSES.includes(cls))
      throw new Error(`Plugin ${name} declares unknown class "${cls}".`);
    if (typeof setup !== "function")
      throw new Error(`Plugin ${name} has no setup function.`);
    if (this.plugins.some((p) => p.name === name))
      throw new Error(`Duplicate plugin name: ${name}`);
    this.plugins.push({ name, version: version || "0.0.0", class: cls });
    setup({
      on: (stage, fn) => this.on(stage, fn, { name, class: cls }),
      log: this.log.child(name),
      policy: this.policy,
    });
    this.log.debug(`registered ${cls}:${name}@${version || "0.0.0"}`);
  }

  /**
   * Discovery, in the order a user would expect their own code to win:
   * built ins, then ./plugins in the project, then anything in the config.
   */
  async discover({ builtinDir, projectDir, extra = [] }) {
    const dirs = [builtinDir, projectDir].filter(Boolean);
    const found = [];
    for (const dir of dirs) {
      let entries = [];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const e of entries.sort()) {
        const p = join(dir, e);
        const s = await stat(p).catch(() => null);
        if (!s?.isDirectory()) continue;
        found.push(join(p, "index.js"));
      }
    }
    for (const spec of extra) found.push(resolve(spec));

    for (const file of found) {
      const key = resolve(file);
      if (this._loaded?.has(key)) continue;
      (this._loaded ??= new Set()).add(key);
      try {
        const mod = await import(pathToFileURL(file).href);
        this.register(mod.default ?? mod);
      } catch (err) {
        this.log.warn(`skipped ${file}: ${err.message}`);
      }
    }
    return this.plugins;
  }

  /**
   * Run the pipeline. Each stage receives the shared context and may mutate it.
   * A plugin throwing stops the run, because a half ported screen is worse than
   * no ported screen.
   */
  async run(ctx) {
    for (const stage of STAGES) {
      const subs = this.bus.get(stage) || [];
      if (!subs.length) continue;
      this.log.stage(stage, subs.length);
      for (const { fn, meta } of subs) {
        const started = Date.now();
        await fn(ctx);
        this.log.debug(`${stage}:${meta.name} ${Date.now() - started}ms`);
      }
    }
    return ctx;
  }
}
