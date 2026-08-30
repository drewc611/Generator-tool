---
name: legacy-to-react
description: Port a legacy front end (Angular, AngularJS, JSF, JSP, Vue 2, plain jQuery) to React while matching the existing look, using screenshots of the running app plus the source. Use whenever someone says "convert this Angular app to React", "rebuild this screen in React", "match the existing UI", "we are migrating off Angular", "modernize this front end", "here are screenshots of the old app", or hands over a legacy component and asks for a React version. Also use when regenerating the API layer during a port, since the API calls are the part most often broken silently. Covers design extraction from screenshots, framework mapping, API client regeneration, parity verification, and the rules that keep the port lawful and inside the security boundary.
---

# Legacy to React

A port is three separate jobs that get conflated and then done badly: matching the
look, translating the framework, and preserving the API contract. Do them in that
order, verify each before moving on, and the port stops being a rewrite with bugs.

The default failure is a React app that technically works, looks nothing like the
original, and quietly calls the wrong endpoints with the wrong payloads. Users
notice the first. Finance notices the third, later, in an invoice.

## What this does and does not do

Does: rebuild screens in React from source plus screenshots, extract a design
system rather than pixel copying, regenerate a typed API client from the legacy
service layer, produce a parity checklist, and verify by building and comparing.

Does not: run against a live production site, use credentials found in legacy
source, call third party APIs without written authorization, or copy licensed
assets. See "Rules that are not negotiable" below. Those are stop conditions,
not preferences.

## Inputs to ask for once, at the start

Ask for all of it in one message. Do not trickle requests.

1. Screenshots of every screen in the running app, at the widths that matter,
   including the states people forget: empty list, validation error, loading,
   a long value that wraps, a permission denied view.
2. The legacy source: templates, component classes, service layer, routing
   config, and any shared styles or theme file.
3. The API contract if one exists: OpenAPI spec, Postman collection, or the
   service files that make the calls.
4. The auth model: how the app gets a session or token today, and whether the
   new app keeps it.
5. Target: a fresh React app, or a component dropped into an existing one.
6. Any hard constraints: no new dependencies, an approved component library,
   a locked design system, an air gapped build.

If screenshots are missing, say so and proceed on source alone, marking every
visual decision as unverified. Do not invent a look and present it as a match.

## Phase 1. Inventory before writing anything

Produce a table the user can correct: screen, route, legacy component file,
services it calls, endpoints those services hit, and the states you can see in
the screenshots. Wrong assumptions are cheap here and expensive later.

Count the screens. If there are more than about six, port one end to end first
and get it approved before touching the rest. A pattern approved once applies
twenty times; a pattern applied twenty times and then rejected is twenty rewrites.

## Phase 2. Extract the system from the screenshots

Read `references/design-extraction.md`. The short version: measure the
screenshots to recover a type scale, a spacing rhythm, color roles, density,
radius, and elevation, then rebuild from those tokens. Do not eyedrop every
value into hardcoded styles. A port that copies pixels inherits every
inconsistency the old app accumulated, and the first new screen has nothing to
follow.

Output a tokens file first, and show it before building components.

## Phase 3. Map the framework

Read `references/angular-to-react-map.md` for the construct by construct
translation, including the traps: two way binding, RxJS subscriptions,
dependency injection, change detection, structural directives, guards, and
forms. The mapping is mechanical once decided; deciding it per file is what
produces an inconsistent codebase.

## Phase 4. Regenerate the API layer

Read `references/api-extraction.md`. This is the phase that fails silently, so
it gets its own verification: for every legacy call, record method, path,
query parameters, body shape, headers, and error handling, then confirm the
React client reproduces all six. A port that drops a header or flips a default
parameter looks fine and behaves differently.

Never hand the browser a credential the legacy app kept on a server.

## Phase 5. Parity and coverage

Before calling a screen done:

- Every state in the screenshots exists in the React version.
- Every state the screenshots lack, but the code implies, exists too: loading,
  empty, error, disabled, permission denied.
- Keyboard reachable, visible focus ring, labels tied to inputs.
- Numbers render with tabular figures and the same formatting rules.
- Long values, seven digit numbers, and missing values do not break layout.
- Nothing renders a zero where the truthful answer is unknown.

## Phase 6. Verify by looking

Build it, screenshot the React version at the same widths, and put the two
images side by side. Fix what is actually different, not what you predicted
would be. If you cannot run it, say so and list what remains unverified.

## Output structure

```
src/
  tokens.ts            design tokens recovered in phase 2
  api/
    client.ts          transport, retry, auth, error normalization
    endpoints.ts       one place where paths live
    fixtures/          recorded responses for tests
  features/<screen>/
    <Screen>.tsx
    use<Screen>Data.ts
    <Screen>.test.tsx
PORT_NOTES.md          decisions, deviations, and what was not verified
```

`PORT_NOTES.md` is not optional. Record every place the React version
deliberately differs from the legacy app and why, every value that could not be
recovered from the screenshots, and every endpoint that could not be verified.
The next person inherits your uncertainty either way; write it down.

## Rules that are not negotiable

These are stop conditions. If one triggers, stop and report rather than
working around it.

**Credentials.** Never use a credential found in legacy source, configuration,
or a screenshot. If you find one, stop, tell the user a secret is exposed in
their repository, name the file and line, and do not print the value, copy it
into the new code, or call anything with it. Treat it as an incident, because
a secret committed to source control is already compromised.

**Live systems.** Do not scrape, crawl, or drive a running production site to
reconstruct behavior. Work from the source, the specification, and the
screenshots the user provides. Recording fixtures from a system the user
operates and authorizes is fine. Hitting someone else's service to learn its
shape is not.

**Third party APIs.** Only call an external API when the user confirms they are
authorized and supplies credentials through their own environment. Respect
published rate limits, quotas, and terms of service. Never bypass
authentication, access control, or a CAPTCHA, and never work around a rate
limit by rotating keys or addresses.

**Billable calls.** Some endpoints charge per call. Before running anything
against a live account, say so and get explicit confirmation. Default to
fixtures for tests. A test suite that bills the customer every run is a defect.

**Assets and licensing.** Fonts, icon sets, images, and component libraries in
the legacy app carry licenses that may not extend to the new app or a new
distribution channel. Confirm before copying. Do not reproduce a third party
product's distinctive interface, trade dress, or branding into an app it does
not belong to.

**Data in screenshots.** Screenshots of a real system routinely contain
customer names, addresses, account numbers, and internal identifiers. Redact
before use, never commit them, and never paste them into generated code as
sample data. Generate synthetic fixtures instead.

**Boundary.** In a regulated or air gapped environment the new app inherits the
old app's authorization boundary. A port is not an opportunity to add a new
external dependency, a public CDN, or an egress path. If the port needs one,
raise it as a change that requires approval, not as an implementation detail.

## When to push back

Say it plainly rather than building around it:

- The screenshots and the source disagree about what a screen does.
- A screen depends on behavior only visible at runtime and no screenshot shows it.
- The legacy app has a feature nobody can explain and no ticket covers.
- The port is being used to quietly change business logic. Separate the two:
  port first, change second, so a regression has one possible cause.
