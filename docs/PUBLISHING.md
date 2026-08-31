# Publishing to npm

The package is ready: `files` ships only `src`, `plugins`, `docs` and
`skills`; there are zero runtime dependencies to audit; the CLI is the `bin`.

```bash
npm test                 # green on 18 and 22 or stop here
npm pack --dry-run       # read the file list. Screenshots and attestations
                         # must not be in it; the ignores keep them out, and
                         # this is where you check.
npm publish              # needs an npm account with the portamp name
```

Publishing is a decision with an owner, so no workflow does it automatically.
The release workflow builds the desktop installers; the npm package is the
tool itself, and shipping it is one command once somebody says so.
