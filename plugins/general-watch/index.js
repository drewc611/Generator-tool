import { watch } from "node:fs";

/**
 * portamp watch: rerun the pipeline when the legacy source changes.
 *
 * Legacy apps do not hold still while somebody ports them. This keeps the
 * output current, debounced, one line per run; pair it with the ui command's
 * --fresh in a second terminal and the console follows along.
 */
export default {
  name: "general-watch",
  version: "0.1.0",
  class: "general",
  setup() {},
  commands: {
    watch: {
      describe: "rerun the pipeline when the source tree changes",
      async run({ config, log, runPipeline }) {
        let running = false;
        let queued = false;
        let timer = null;

        const runOnce = async (reason) => {
          if (running) { queued = true; return; }
          running = true;
          const started = Date.now();
          try {
            const ctx = await runPipeline();
            log.info(`${new Date().toLocaleTimeString()}  ${reason}: ${ctx.written.length} file(s), ${ctx.report.unverified.length} unverified, ${Date.now() - started}ms`);
          } catch (err) {
            log.error(`${reason}: ${err.message}`);
          }
          running = false;
          if (queued) { queued = false; runOnce("queued change"); }
        };

        await runOnce("first run");
        log.info(`watching ${config.src}  (ctrl-c to stop)`);

        watch(config.src, { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => runOnce("changed"), 200);
        });

        // Keep the process alive until the person says otherwise.
        await new Promise(() => {});
      },
    },
  },
};
