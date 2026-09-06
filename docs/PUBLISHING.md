# Publishing to npm

The package is the tool itself. `files` ships `src`, `plugins`, `docs` and
`skills`; npm adds `package.json`, `README.md` and `LICENSE` on its own and
nothing else gets in. There are zero runtime dependencies to audit, the CLI is
the `bin`, and the kernel, the policy and the context are the `exports`. Two
tests hold that: test/publish.test.js reads the dry run's file list and
refuses a stray top level, an attestation, a recording, a dotenv or a key;
test/installed.test.js packs the real tarball, unpacks it in a temp directory
and runs the shipped cli from there, with no repository around it, asserting
the roster matches the checkout's and a run over the example writes
PORT_NOTES.md. CI runs the second one alone as its own step, so a tarball that
only works inside the checkout fails by name.

## Before a release

```bash
npm test                          # green on 18, 20 and 22 or stop here
npm run pack:check                # publish-check: the dry run read for you.
                                  # Only the declared top levels ship, no
                                  # screenshot, attestation, dotenv or key is
                                  # in the list, zero runtime dependencies,
                                  # the bin is in the tarball. Exit 1 on any
                                  # FAIL. It never publishes.
npm pack --dry-run                # the same list, by eye, if you want to see it
```

## The release

Publishing is a decision with an owner, so the act that publishes is one a
person performs: pushing a version tag.

```bash
npm version minor                 # writes package.json and makes the v10.2.0 tag
git push --follow-tags            # the tag starts .github/workflows/release.yml
```

The `npm` job in that workflow runs on Node 20 and, in order: runs the suite;
runs publish-check; checks that the tag is `v` plus the version package.json
states and fails naming both when they differ; checks that package.json does
not say `"private": true`; checks that the `NPM_TOKEN` secret exists; and
only then runs `npm publish --provenance --access public`. Each check that
fails says what a person must do. Nothing is published on a failed step, and
nothing is published from a run started by hand from the Actions tab, which
builds the desktop installers only.

## The token

npm needs a token to accept the publish and the token belongs to a person.
Create a granular access token on npmjs.com that is allowed to publish the
`portamp` package and nothing more, and add it to the repository under
Settings, Secrets and variables, Actions, with the name `NPM_TOKEN`. The
workflow reads it into `NODE_AUTH_TOKEN` for the one publish step and nowhere
else. The secret never appears in a workflow file, in the tree, in a log line
or in this document, which is the same rule the secret gate holds the source
to. When the secret is missing the job stops with a message naming it and
where to add it, rather than failing inside npm with an authentication error.

## Provenance

`--provenance` asks npm to attach a signed statement to the published version
recording which repository, workflow and run built the tarball, and the
registry shows it beside the version. That statement is signed against the
workflow's own identity, which is why the job asks for `id-token: write` and
`contents: read` and no more. A person installing the package can then check
that the tarball on the registry is the one this workflow built from this tag.

## What stands in the way today

package.json says `"private": true`, set on purpose when the licence became
proprietary so that nobody publishes by accident. Every `npm publish`,
including the workflow's, refuses while that line stands, and the workflow
says so and stops before it reaches npm. Removing the line is the decision
this document is waiting on, and it belongs to the copyright holder.
