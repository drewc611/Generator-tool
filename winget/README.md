# winget manifest

`manifests/d/drewc611/portamp/0.1.0/` holds the three files a
[winget-pkgs](https://github.com/microsoft/winget-pkgs) submission needs:
a version manifest, an `en-US` locale manifest, and an installer manifest.
The first two are complete. The installer manifest is not — its
`InstallerUrl` and `InstallerSha256` are named placeholders, because
winget validates a hash against the real file and neither exists yet:
no `v*` tag has been pushed, so `.github/workflows/release.yml` has never
built `desktop/dist/portamp Setup 0.1.0.exe`. The installer manifest file
itself says exactly what to fill in and how, once that release exists.

`0.1.0` is `desktop/package.json`'s own version, not the npm package's —
winget packages the desktop installer, not the CLI, so it tracks that
version instead.

Submitting is a pull request into `microsoft/winget-pkgs`, a separate
repository this tool has no access to and should not be pushed to without
you reviewing it first. Once the installer manifest is real,
[`wingetcreate submit`](https://github.com/microsoft/winget-create) can
build and open that PR from these three files directly.
