# Pushing this to github.com/drewc611/portamp

From the unzipped folder:

```bash
cd portamp
git init -b main
git add .
git commit -m "portamp: tiny core, plugin driven legacy to React porting"
git remote add origin https://github.com/drewc611/portamp.git
git push -u origin main
```

If the repo already exists with a different name, rename it in Settings first,
then push. GitHub redirects the old URL, so nothing breaks.

If you started from the Generator-tool repo and want the history:

```bash
git remote set-url origin https://github.com/drewc611/portamp.git
git push -u origin main
```

Before the first push, confirm two things:

- `portamp.authorization.json` is not committed if it names a real customer.
  The example file is safe; the real one may not be.
- `example/screenshots/` holds placeholder files only. Recorded screenshots of a
  real system do not belong in a public repository.
