/**
 * Policy is a first class part of the kernel, not advice in a README.
 * A plugin that wants to do something consequential has to ask.
 *
 * The rules exist because a port touches three dangerous things at once:
 * credentials committed in legacy source, live systems that bill per call,
 * and customer data sitting inside screenshots.
 */

const SECRET_PATTERNS = [
  [/\b(consumer|client)[_-]?secret\s*[:=]\s*['"][^'"]{8,}['"]/i, "client secret"],
  [/\bapi[_-]?key\s*[:=]\s*['"][^'"]{12,}['"]/i, "api key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "aws access key id"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]{24,}=*/, "hardcoded bearer token"],
  [/\bpassword\s*[:=]\s*['"][^'"]{6,}['"]/i, "password"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "slack token"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, "github token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "github fine grained token"],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, "gitlab token"],
  [/\bsk_live_[A-Za-z0-9]{16,}\b/, "stripe live key"],
  [/\bnpm_[A-Za-z0-9]{30,}\b/, "npm token"],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/, "google api key"],
  // Three base64url segments joined by dots is a signed token whatever
  // service minted it; the header segment always starts with eyJ.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, "signed jwt"],
];

export class PolicyViolation extends Error {
  constructor(message, { rule, file, line, path } = {}) {
    super(message);
    this.name = "PolicyViolation";
    this.rule = rule;
    this.file = file;
    this.line = line;
    this.path = path;
  }
}

export class Policy {
  constructor({ allowLive = false, allowBillable = false, allowedDomains = null, offline = false, log } = {}) {
    this.allowLive = allowLive;
    this.allowBillable = allowBillable;
    // offline outranks everything, including an attestation and --allow-live.
    // It exists for CI: a run that must not reach the network says so once,
    // and no flag combination argues it back open.
    this.offline = Boolean(offline);
    // Domains the attestation names. null means the attestation named none
    // and --allow-live alone governs; a list narrows the gate further and
    // nothing widens it back.
    this.allowedDomains = Array.isArray(allowedDomains) && allowedDomains.length
      ? Object.freeze(allowedDomains.map((d) => String(d).toLowerCase().replace(/^\*\./, "")))
      : null;
    this.log = log;
    this.findings = [];

    // A gate that can be reassigned is a gate that will be, by a plugin that
    // finds it inconvenient. findings stays pushable because the array itself
    // is not frozen, only the binding to it.
    Object.freeze(this);
  }

  /**
   * Scan text for credentials. Records the location and the kind, never the
   * value, because writing a secret into a report just moves the exposure.
   */
  scanForSecrets(text, file) {
    const lines = text.split("\n");
    const hits = [];
    lines.forEach((line, i) => {
      for (const [re, kind] of SECRET_PATTERNS) {
        if (re.test(line)) {
          hits.push({ kind, file, line: i + 1 });
          break;
        }
      }
    });
    this.findings.push(...hits);
    return hits;
  }

  /** A credential found in source is already compromised. Stop, do not use it. */
  assertNoSecrets() {
    if (!this.findings.length) return;
    const lines = this.findings
      .map((f) => `  ${f.file}:${f.line}  ${f.kind}`)
      .join("\n");
    throw new PolicyViolation(
      `Credentials found in the legacy source. Stopping.\n${lines}\n` +
        `These are already compromised and need rotating. Nothing was copied ` +
        `into the port and no value was printed.`,
      { rule: "no-credentials-in-source" }
    );
  }

  /**
   * Any network call against a real system needs an explicit opt in, and when
   * the attestation names domains, the call must be to one of them. The list
   * only ever narrows the gate: an attestation for one system is not
   * permission to drive whatever the tool finds a link to.
   */
  assertLiveAllowed(target) {
    if (this.offline) {
      throw new PolicyViolation(
        `Refusing to call ${target}. This run is offline: --offline outranks ` +
          `--allow-live and the attestation both, which is the point of it.`,
        { rule: "offline" }
      );
    }
    if (!this.allowLive) {
      throw new PolicyViolation(
        `Refusing to call ${target}. Live calls are off by default. ` +
          `Re run with --allow-live once you have confirmed you are authorized ` +
          `to call it, or record fixtures instead.`,
        { rule: "no-live-calls" }
      );
    }
    if (this.allowedDomains) {
      let host = null;
      try {
        host = new URL(String(target)).hostname.toLowerCase();
      } catch {
        // A target that is not a URL (a bare host, a socket) is judged as a
        // hostname string rather than waved through.
        host = String(target).toLowerCase().split("/")[0].split(":")[0];
      }
      // A loopback call cannot leave the machine, so the domain list does not
      // govern it; --allow-live still does.
      if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) return true;
      const allowed = this.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
      if (!allowed) {
        throw new PolicyViolation(
          `Refusing to call ${target}. The attestation authorizes ${this.allowedDomains.join(", ")} ` +
            `and this call is to ${host}. Add the domain to portamp.authorization.json only if the ` +
            `authorization actually covers it.`,
          { rule: "live-call-outside-attested-domains" }
        );
      }
    }
    return true;
  }

  /** Some endpoints charge per request against a payment account. */
  assertBillableAllowed(target) {
    this.assertLiveAllowed(target);
    if (this.allowBillable) return true;
    throw new PolicyViolation(
      `${target} is marked billable. Every call charges the account. ` +
        `Re run with --allow-billable if that is intended.`,
      { rule: "no-billable-calls" }
    );
  }

  /**
   * Endpoints live in one module. A path baked into a component is a path
   * nobody can change without editing the view, and it is how a port ends up
   * with staging in three screens and production in the rest.
   *
   * Checked against the endpoint map rather than against a URL shaped regular
   * expression, because a template may legitimately link to somewhere that is
   * not an endpoint, and refusing to port a documentation link would be the
   * gate getting in the way of correct work.
   */
  /** What evidence would clear each stop. A gate that only says no teaches
   * nobody; the rule stays exactly as hard, and the way through is named. */
  static clears(rule) {
    return {
      "no-credentials-in-source": "rotate the credential, move it to an env var or secret store, remove it from the source, and rerun. The value was never printed.",
      "offline": "this run was started with --offline, which outranks everything. Drop the flag, or keep it and accept that nothing live is reached.",
      "no-live-calls": "pass --allow-live true and provide portamp.authorization.json naming who owns the system.",
      "live-call-outside-attested-domains": "add the domain to portamp.authorization.json's domains list, if the owner it names actually owns that host.",
      "no-billable-calls": "pass --allow-billable true once the metered cost is accepted.",
      "no-endpoints-in-components": "move the path into src/api/endpoints.js and call it through the generated client; a component keeps a name, never an address.",
    }[rule] ?? null;
  }

  assertNoEndpointLiteral(text, file, paths = [], routes = []) {
    // Navigation to the run's own routes is not a call. A portal's filter
    // form posts to the path its page lives at, so a link or the route
    // table can spell the same string an API answers. Only a value the run
    // itself serves as a route is masked, and only in a navigation
    // position; an anchor pointing at any other endpoint, or the same path
    // in a fetch, a client call or a bare string, still stops the run.
    let body = String(text ?? "");
    for (const route of routes) {
      const safe = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = body
        .replace(new RegExp(`\\b(?:href|to)="${safe}"`, "g"), "")
        .replace(new RegExp(`\\bpath: "${safe}",`, "g"), "");
    }
    for (const path of paths) {
      if (!path || path.length < 2) continue;
      // The path must begin and end where the path does: /apis inside
      // another host's URL, a longer path, or a hostname is letters that
      // happen to rhyme, not this app's endpoint.
      const safe = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exact = new RegExp("(?<![\\w.\\-/])" + safe + "(?![\\w.-])");
      if (exact.test(body)) {
        throw new PolicyViolation(
          `${file} contains the endpoint ${path}. Endpoints belong in src/api/endpoints.js, ` +
            `so that moving one is a single edit and no screen can disagree about it.`,
          { rule: "no-endpoints-in-components", file, path }
        );
      }
    }
    return true;
  }

  /** Screenshots of a real system routinely carry customer data. */
  warnOnFixtureData(sample, file) {
    const risky =
      /\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b|@[a-z0-9.-]+\.(com|org|gov)\b/i.test(sample);
    if (risky)
      this.log?.warn(
        `${file} looks like it contains real data. Sanitize before committing it as a fixture.`
      );
    return risky;
  }
}
