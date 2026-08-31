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
  constructor({ allowLive = false, allowBillable = false, log } = {}) {
    this.allowLive = allowLive;
    this.allowBillable = allowBillable;
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

  /** Any network call against a real system needs an explicit opt in. */
  assertLiveAllowed(target) {
    if (this.allowLive) return true;
    throw new PolicyViolation(
      `Refusing to call ${target}. Live calls are off by default. ` +
        `Re run with --allow-live once you have confirmed you are authorized ` +
        `to call it, or record fixtures instead.`,
      { rule: "no-live-calls" }
    );
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
  assertNoEndpointLiteral(text, file, paths = []) {
    const body = text ?? "";
    for (const path of paths) {
      if (!path || path.length < 2) continue;
      if (body.includes(path)) {
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
