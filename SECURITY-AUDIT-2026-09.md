# Security audit — Generator-tool — 2026-09-27

Part of a 22-repository audit of this account. The cross-repository report (method, pain points, business impact, solution analysis, roadmap) is published at https://claude.ai/artifact/KgdrC9eNyCwdqjvSfwMNuB.

## Summary for this repository

| Severity | Count |
|---|---|
| Medium | 2 |
| Low | 2 |

Automated passes run against this repository: gitleaks 8.24.2 (full history and tree), the placeholder-credential checker now shipped in `scripts/`, semgrep 1.178.0 (`p/security-audit`, `p/secrets`, `p/owasp-top-ten`, `p/github-actions`), bandit, pip-audit and npm audit where applicable, plus a manual review of auth, input handling, workflows and deployment files.

## Findings

| ID | Severity | Category | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|---|
| GT-1 | Medium | Local console accepts cross-site requests in loopback mode | `plugins/vis-ui/index.js:362-370,404-447,502-504` | Token required only when `--lan`; no `Host`/`Origin`/`Sec-Fetch-Site` check on `POST /rerun`, `/intake`, `DELETE /intake`, `GET /source` | A web page the developer visits can trigger reruns, plant or wipe intake files, and with DNS rebinding read ported customer source. | Reject non-loopback `Host` and cross-site `Origin`; or always require the token. | open |
| GT-2 | Medium | CI has no `permissions:` block; release actions on mutable tags | `.github/workflows/ci.yml:1-5; release.yml:9-10,23-24` | No `permissions` key in ci.yml; `softprops/action-gh-release@v3` with `contents: write` at top level | Token inherits repository default; a repointed third-party tag runs with release-write. | `permissions: contents: read` at top; pin SHAs; scope write to the release step. | open |
| GT-3 | Low | Test fixtures trip generic secret scanners | `test/policy.test.js:11; test/analysis2.test.js:45; .github/workflows/ci.yml:372; test/fixtures/env-app/.env` | `sk_live_notarealvalue1234`, a 32-char `secretish` string, `apiKey: "0123456789abcdef"`, a fixture `.env` (non-secret values) | False positives that train people to ignore scanner output. | Allowlisted by path and value in `.gitleaks.toml` in this PR; keep fixtures under `test/`. | open |
| GT-4 | Low | Desktop shell dependencies | `desktop/package-lock.json` | npm audit (incl. dev): 13 High, 1 Critical in build tooling | Build-time only. | `npm audit fix` in `desktop/`. | open |

## Guardrails added in this change

- `scripts/check-placeholder-secrets.sh` — fails the build on placeholder credentials, secret defaults, disabled-auth defaults, `debug=True`, literal secret assignments, private keys and committed `.env` files.
- `.gitleaks.toml` — gitleaks defaults plus custom placeholder rules and a fixture allowlist.
- `.github/workflows/secret-scan.yml` — runs both on every push and pull request and weekly over full history (SHA-pinned actions).
- `.pre-commit-config.yaml` — the same checks locally; run `pre-commit install` once.
- `docs/security/AI-CODING-GUARDRAILS.md` — the binding rules for any AI-assisted change, with references.
- A "Security rules for AI-assisted changes" section in `CLAUDE.md` (and `AGENTS.md` / Copilot instructions where present).
- `.gitignore` rules for `.env`, keys and Terraform state where they were missing.

See the cross-repository report for the fail-closed pattern by language and the prioritised fix list.
