# portamp for the desktop

The same console the CLI serves, in a window. The pipeline, the policy gates
and the server are imported from the repository that ships inside the app, so
the desktop build can never disagree with the command line about what a run did.

## Run it in development

```bash
cd desktop
npm install
npm start
```

## Build installers

```bash
npm run dist        # the current platform
```

CI builds all three on every release tag: `.dmg` for macOS, an NSIS installer
for Windows, an AppImage for Linux. See `.github/workflows/release.yml`.

The server inside still binds 127.0.0.1 only. A window in front of the console
does not change what it serves, or to whom.
