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
