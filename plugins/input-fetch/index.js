import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetchSite, mapSite } from "./fetch.js";

/**
 * The reader for a site you can reach but do not have: `portamp fetch <url>`
 * copies one origin's pages and assets into a folder, and the folder is then
 * what every other reader ports, input-static and the site engine first.
 *
 * It is the no source path, so it stands behind the same two gates as the
 * recorder: live calls are off until --allow-live, and nothing is fetched
 * without portamp.authorization.json naming who owns the system and, where
 * it names domains, the domain being fetched. The console's intake asks this
 * plugin the same way, through the command's own function, so a URL typed
 * into the page goes through exactly these gates and no others.
 */

/** The attestation on disk, or the reason there is none. */
export async function readAttestation(cwd) {
  try {
    const att = JSON.parse(await readFile(join(cwd, "portamp.authorization.json"), "utf8"));
    if (!att || typeof att !== "object") return { error: "portamp.authorization.json is not an object" };
    if (!att.owner || !att.authorizedBy) return { error: "portamp.authorization.json must name owner and authorizedBy" };
    return { attestation: att };
  } catch (err) {
    return { error: err.code === "ENOENT" ? "no portamp.authorization.json in the working directory" : `portamp.authorization.json is not readable json: ${err.message}` };
  }
}

/**
 * Copy a site for a run: refuses without the attestation, then lets the policy
 * refuse without --allow-live or outside the attested domains. Returns the
 * manifest, and the folder the copy landed in.
 */
export async function fetchForRun({ url, dir, cwd = process.cwd(), policy, log, depth, maxPages }) {
  const { attestation, error } = await readAttestation(cwd);
  if (error) {
    throw new Error(
      `Copying a site is the no source path and needs portamp.authorization.json beside the run, naming who owns ${url} and on what basis you may port it (${error}). ` +
        "Live calls also need --allow-live. Neither is a default."
    );
  }
  const manifest = await fetchSite({ url, dir, policy, log, depth, maxPages });
  manifest.attestedBy = attestation.authorizedBy;
  return manifest;
}

/**
 * Discover a site's own URLs for a run: the same attestation and policy gates
 * as copying it, since mapping still reaches a live system, but nothing is
 * downloaded to keep. Scoping a migration this way is the question to ask
 * before fetchForRun answers it by copying everything.
 */
export async function mapForRun({ url, dir = null, cwd = process.cwd(), policy, log, depth, maxPages, sitemap }) {
  const { attestation, error } = await readAttestation(cwd);
  if (error) {
    throw new Error(
      `Mapping a site is still a live call to a real system and needs portamp.authorization.json beside the run, naming who owns ${url} and on what basis you may map it (${error}). ` +
        "Live calls also need --allow-live. Neither is a default."
    );
  }
  const manifest = await mapSite({ url, dir, policy, log, depth, maxPages, sitemap });
  manifest.attestedBy = attestation.authorizedBy;
  return manifest;
}

export default {
  name: "input-fetch",
  version: "0.1.0",
  class: "input",
  commands: {
    fetch: {
      describe: "copy a site's pages into a folder to port: portamp fetch <url> [--out dir] [--depth n] [--max n]; needs --allow-live and portamp.authorization.json",
      async run({ config, log, policy, args }) {
        const url = args._[1];
        if (!url) throw new Error("portamp fetch <url>: no url given");
        const dir = resolve(process.cwd(), args.out ?? "./fetched");
        const manifest = await fetchForRun({
          url, dir, policy, log,
          depth: args.depth === undefined ? 2 : Number(args.depth),
          maxPages: args.max === undefined ? 50 : Number(args.max),
        });
        log.info(`copied into ${dir}; FETCH.md lists every page, asset and skip. Port it with: node src/cli.js run --src ${dir} --site true`);
        return manifest;
      },
    },
    map: {
      describe: "discover every url an attested site's sitemap and pages name, nothing downloaded: portamp map <url> [--out dir] [--depth n] [--max n] [--sitemap false]; needs --allow-live and portamp.authorization.json",
      async run({ log, policy, args }) {
        const url = args._[1];
        if (!url) throw new Error("portamp map <url>: no url given");
        const dir = args.out ? resolve(process.cwd(), args.out) : null;
        const manifest = await mapForRun({
          url, dir, policy, log,
          depth: args.depth === undefined ? 3 : Number(args.depth),
          maxPages: args.max === undefined ? 500 : Number(args.max),
          sitemap: args.sitemap !== "false",
        });
        log.info(`${manifest.urls.length} url(s) found${dir ? `; MAP.md and portamp.map.json written under ${dir}` : " (pass --out to write MAP.md and portamp.map.json)"}.`);
        return manifest;
      },
    },
  },
  setup({ on, log }) {
    // A copy the fetch command made carries its own manifest; when a run reads such a folder the manifest's gaps
    // become the run's notes, so a page the copy skipped is never mistaken for a page the site did not have.
    on("scan", async (ctx) => {
      const manifest = await readFile(join(ctx.config.src, "portamp.fetch.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!manifest) return log.debug("no fetch manifest in the source tree");
      ctx.fetched = manifest;
      log.info(`the source is a copy of ${manifest.start}: ${manifest.pages.length} page(s), ${manifest.skipped.length} skipped`);
      ctx.unverified(`The source is a copy of ${manifest.start} fetched ${manifest.startedAt}, as an anonymous visitor; anything behind a login, a form or a script was not seen.`);
      if (manifest.skipped.length) {
        ctx.unverified(`${manifest.skipped.length} request(s) were skipped while copying (${[...new Set(manifest.skipped.map((s) => s.reason))].slice(0, 4).join("; ")}); FETCH.md in the source lists each, so a missing page is a known gap, not a page the site lacked.`);
      }
      if (manifest.external?.length) ctx.unverified(`The site leaned on ${manifest.external.length} other host(s) (${manifest.external.slice(0, 5).join(", ")}); nothing from them was fetched.`);
    });
  },
};
