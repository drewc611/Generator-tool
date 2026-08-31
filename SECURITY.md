# Security

## Reporting

Open a private advisory through GitHub's "Report a vulnerability" on the
Security tab. Do not open a public issue for anything exploitable.

## What this tool touches

portamp is a local command line tool with no runtime dependencies and no
network calls of its own. Three parts of it are worth your attention:

- **It reads source you point it at**, including source that may contain
  credentials. The policy engine stops the run when it finds one, reports the
  file and line, and never prints or copies the value. A way to make it print a
  secret is a vulnerability.
- **It can drive a running application** (`input-explore`, `input-record`),
  which requires both `portamp.authorization.json` and `--allow-live`. A way to
  reach the network without both gates is a vulnerability.
- **It can serve a local UI** (`portamp ui`), which binds `127.0.0.1` only and
  reads from the output and screenshot directories. A path that escapes either
  directory, or a bind on any other interface, is a vulnerability.

## What is not a vulnerability

- `--allow-live` doing what it says.
- `explore.allowDestructive` doing what it says. It is off by default and every
  skipped control is listed in the report.
- The tool reading a file you gave it.

## Attestations and recordings

`portamp.authorization.json`, recorded screenshots and `exploration.json` all
describe somebody's real system. They are gitignored here on purpose. Do not
attach any of them to an issue.
