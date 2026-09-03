import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The gate in front of every no source path.
 *
 * Modernizing software you own is ordinary engineering. Reconstructing software
 * you do not own is a different activity with a different name, and the tool
 * should not make it easy to slide from one into the other by accident. So any
 * run that ingests a legacy system without its source requires a signed
 * attestation on disk saying who owns it and on what basis you may modify it.
 *
 * The file is portamp.authorization.json in the project root:
 *
 *   {
 *     "system": "Claims Intake, internal",
 *     "owner": "Acme Insurance",
 *     "relationship": "owner",         owner | licensee | contractor
 *     "basis": "Internally developed, owned outright.",
 *     "attestedBy": "A. Clark",
 *     "attestedOn": "2026-08-30",
 *     "sourceAvailable": false,
 *     "artifacts": ["screenshots", "har", "schema"]
 *   }
 */

const RELATIONSHIPS = new Set(["owner", "licensee", "contractor"]);

const FORBIDDEN = [
  [/\b(crack|keygen|activation bypass|license bypass)\b/i, "license or activation circumvention"],
  [/\b(drm|copy protection)\s*(removal|strip|bypass)\b/i, "technical protection circumvention"],
  [/\bdefeat\s+(the\s+)?(license|activation|protection)\b/i, "protection defeat"],
];

export default {
  name: "general-authorization",
  version: "0.1.0",
  class: "general",
  setup({ on, log }) {
    on("scan", async (ctx) => {
      const path = join(process.cwd(), "portamp.authorization.json");
      let att = null;
      try {
        att = JSON.parse(await readFile(path, "utf8"));
      } catch {
        ctx.authorization = null;
        log.debug("no attestation on disk");
        return;
      }

      const missing = ["system", "owner", "relationship", "basis", "attestedBy", "attestedOn"]
        .filter((k) => !att[k]);
      if (missing.length)
        throw new Error(
          `portamp.authorization.json is incomplete. Missing: ${missing.join(", ")}. ` +
            `An incomplete attestation is worse than none, because it looks like one.`
        );

      if (!RELATIONSHIPS.has(att.relationship))
        throw new Error(
          `relationship must be one of owner, licensee, contractor. Got "${att.relationship}".`
        );

      for (const [re, kind] of FORBIDDEN) {
        if (re.test(att.basis))
          throw new Error(
            `Refusing to run. The stated basis describes ${kind}, which portamp will not do ` +
              `regardless of who owns the software.`
          );
      }

      // An attestation can carry its own shelf life. Past it, the file is a
      // record of what was once true, and the gate treats it as absent; a
      // contractor's engagement ending is exactly the case this exists for.
      if (att.expires) {
        const expiry = Date.parse(att.expires);
        if (Number.isNaN(expiry))
          throw new Error(`expires is "${att.expires}", which does not parse as a date. Use ISO: 2026-12-31.`);
        if (expiry < Date.now())
          throw new Error(
            `portamp.authorization.json expired on ${att.expires}. Whoever attested it should confirm the ` +
              `authorization still stands and re-date it; a run on a stale attestation is a run without one.`
          );
        if (expiry - Date.now() < 7 * 24 * 60 * 60 * 1000) {
          ctx.unverified(`The attestation expires on ${att.expires}, under a week from now. Renew it before it lapses mid engagement.`);
        }
      }

      if (att.relationship === "contractor" && !att.engagement)
        throw new Error(
          `relationship is "contractor" but no engagement is named. Add the statement of ` +
            `work or contract reference that authorizes modification.`
        );

      if (att.relationship === "licensee" && !att.licensePermitsModification)
        throw new Error(
          `relationship is "licensee". Set licensePermitsModification to true only after ` +
            `confirming the license actually allows derivative works. Many do not, and a ` +
            `port is a derivative work.`
        );

      ctx.authorization = att;
      log.info(`authorized: ${att.system}, ${att.relationship} of ${att.owner}, attested ${att.attestedOn}`);
      ctx.note(
        `Authorization on file: ${att.relationship} of ${att.owner}, attested by ${att.attestedBy} on ${att.attestedOn}.`
      );
    });
  },
};
