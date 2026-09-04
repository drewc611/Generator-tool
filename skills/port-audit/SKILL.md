---
name: port-audit
description: Judge whether a finished portamp port is fit to ship, using the evidence the run wrote about itself rather than optimism. Use when someone says "is this port done", "review the port", "can we ship this", "audit the migration", "what did the tool actually do", or before any cutover from the legacy app to the ported one. Covers reading the ledger and the notes in the right order, running the audit command, the checks no tool can do for you, and how to write up what you found without softening it.
---

# Port audit

A portamp run writes down every decision it made and every gap it could not
close. Auditing a port is reading that record in the right order and then
doing the three checks only a person can do. The failure mode is reviewing
the code and skipping the evidence, which reviews the half that was
generated correctly by construction and ignores the half that matters.

## Read in this order

1. **`PORT_NOTES.md`** — every unverified item. This is the contract: each
   line is something the tool declined to guess. The audit is done when
   every line is either resolved, accepted with a name attached, or turned
   into a ticket. An unread note is a defect waiting for production to
   find it first.
2. **`LEDGER.json`** — every decision, machine readable: routes with the
   sha256 of the bytes they were read from, redirects with their reasons,
   chrome lifts, proposals, dead links, orphans. Diff two runs' ledgers to
   see what a rerun changed.
3. **`DOCS.md`, `ERA.md`, `SITE.md`, `LOGS_404.md`** — the domain reports,
   each naming its own limits. `SITE_STATS.md` says where the weight is.
4. **The diff between proposal and performance** — anything run behind a
   performing flag (`--perform-tables`, `--uplift`) keeps its original
   beside the result. Read those diffs; they are short and they are where
   a silent layout break would live.

## Run the machine checks

```bash
node src/cli.js audit --out <port>    # the port against its own ledger
cd <port> && npm test                 # the suites that ship inside the port
```

The audit command proves routes have components, redirects resolve, and
the sitemap is complete; the port's own suite proves the router, server,
search, and export behave. Both green is necessary and nowhere near
sufficient: they prove the port agrees with itself, not with the legacy
app.

## The three checks only a person can do

1. **Walk one real task end to end.** Pick the thing users actually come
   to do and do it in both apps side by side. The states people forget are
   the states the legacy app handled in code nobody read: empty list,
   validation error, expired session, a value long enough to wrap.
2. **Read the API surface like an invoice.** `src/api/endpoints.js` is the
   whole contract the port claims. Every call the legacy app made that is
   not in the map is a feature that silently died; the behavior report and
   the curl smoke script are the fastest cross check.
3. **Check the addresses with real demand.** Old URLs live in bookmarks,
   emails, and other people's sites. The redirect map plus `LOGS_404.md`
   against real traffic is evidence; the map alone is hope.

## Severity, honestly

- **Blocks cutover**: a wrong endpoint or payload, a route with no
  component, a redirect cycle, a secret in the emitted tree, a state the
  legacy app had that the port cannot reach.
- **Ship with a named owner**: unverified items accepted as risks, glyph
  gaps in documents, a locale tree left unmerged, uncovered 404 demand.
- **Cosmetic**: everything the parity pane shows that no user task
  touches. Fidelity is judged in the compare pane by a person, not by a
  pixel number; the tool says so itself.

## Writing it up

Lead with the verdict and the count of blockers, then the blockers each in
one line with the file that proves it, then the accepted risks with their
owners. Do not average the findings into a score; a port with one wrong
endpoint and perfect pixels is broken, and a port with ugly spacing and a
faithful contract is shippable. If the audit was clean, say what was
checked, not just "looks good" — a clean audit of four checks is worth
exactly four checks.
