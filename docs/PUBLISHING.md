# Publishing to npm

The package is ready: `files` ships only `src`, `plugins`, `docs` and
`skills`; there are zero runtime dependencies to audit; the CLI is the `bin`.

```bash
npm test                          # green on 18 and 22 or stop here
node src/cli.js publish-check     # the dry run, read for you: only the declared
                                  # top levels ship, no screenshot, attestation,
                                  # dotenv or key is in the list, zero runtime
                                  # dependencies, the bin is in the tarball.
                                  # Exit 1 on any FAIL. It never publishes.
npm publish                       # needs an npm account with the portamp name
```

Publishing is a decision with an owner, so no workflow does it automatically.
The release workflow builds the desktop installers; the npm package is the
tool itself, and shipping it is one command once somebody says so.
