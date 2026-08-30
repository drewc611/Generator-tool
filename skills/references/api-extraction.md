# API extraction and regeneration

This is the phase that fails silently. A visual difference gets reported in a
day. A dropped header or a flipped default parameter can run for months.

## Step 1. Inventory every call

Read the legacy service layer, not the components. For each call record six
things, and treat any one you cannot determine as a blocker rather than a guess:

1. Method and full path, including how the path is built and what is interpolated.
2. Query parameters, including defaults applied when the caller passes nothing.
3. Request body shape, with field names exactly as sent.
4. Headers, including any added by an interceptor rather than the call site.
5. Response shape used by the UI, which is often a subset of what is returned.
6. Error handling, including which statuses are treated as recoverable.

Interceptors are the usual source of missed items. Grep for them first, because
the headers they add appear at no call site.

## Step 2. Reconcile against the specification

If an OpenAPI document or a Postman collection exists, diff the inventory against
it. Where they disagree, the running code wins for behavior and the specification
wins for intent. Report the difference rather than silently choosing, since a gap
between spec and code is usually a defect somebody should know about.

## Step 3. Rebuild as one client

Not a fetch call per component. One module owning transport, auth, retry,
timeout, cancellation, caching, and error normalization, plus one file holding
every path. The UI should never contain a URL.

The client needs:

- **Timeout** per attempt, with an AbortController, so a hung request cannot
  wedge a screen.
- **Retry** on 429, 408, and 5xx only, with exponential backoff and jitter,
  honoring `Retry-After` when the server sends one. Never retry a non idempotent
  write without an idempotency key.
- **Cancellation** propagated from the component, so unmounting aborts in flight
  requests and a fast typist does not race their own results.
- **Deduplication** of identical in flight GETs.
- **Normalized errors** carrying status, an application code, and a request id,
  with a separate function producing user facing text. Never render a stack or a
  raw upstream message to a user.
- **Remappable endpoints and field mapping**, so a backend path or field rename
  does not reach into the components.

## Step 4. Auth, which is where ports leak credentials

The legacy app's auth model is the specification. Reproduce it, do not simplify it.

- A client secret, consumer key, or signing key that lived on a server stays on a
  server. Moving it into a React bundle to make the port easier publishes it.
  Anything in a browser bundle is public.
- A client credentials grant cannot run in a browser. If the legacy app performed
  one server side, the React app calls your own backend, which performs it.
- Token caching and refresh belong in the client module, with a single refresh in
  flight at a time so a burst of 401s does not trigger a stampede.
- Prefer the session the browser already has, sent as a cookie with the request,
  over handing the front end a bearer token to store.

If you find a credential committed in the legacy source, stop. Report the file
and line, do not print the value, and do not carry it into the new code. It is
already compromised and needs rotating, which is a decision for the owner.

## Step 5. Test without calling anything real

Record fixtures from a system the user operates and authorizes, sanitize them of
customer data, and commit those. Tests run against fixtures.

This matters more than usual when calls are billable. Some endpoints charge per
request against a payment account, so a test suite pointed at a live account
bills the customer on every run. Default to fixtures and require explicit
confirmation before any run touches a live account.

## Step 6. Verify the contract, not the screen

For every call in the inventory, confirm the React client reproduces all six
recorded items. Diff the actual outbound requests, from a network log or a
recording proxy against a system the user controls, rather than reading the code
and assuming. The failure mode here is a request that looks right and differs in
one parameter.

## Rules

- Only call an API the user is authorized to call, with credentials supplied
  through their own environment.
- Respect published rate limits and quotas. Never bypass a limit by rotating keys
  or addresses, and never bypass authentication or a CAPTCHA.
- Do not scrape or drive a live third party site to learn an API's shape. Work
  from source, specification, and authorized recordings.
- Sanitize fixtures. Real responses carry customer names, addresses, and account
  identifiers, and those must not land in a repository.
- In a regulated environment, the port inherits the existing authorization
  boundary. A new endpoint, a new external dependency, or a new egress path is a
  change requiring approval, not an implementation detail.
