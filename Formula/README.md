# Homebrew formula

`portamp.rb` is a tap formula, not a homebrew-core submission — portamp's
licence is proprietary, all rights reserved, which homebrew-core does not
accept for the primary formula (a `head` install of the same repository is
fine either way, and is included).

```bash
brew tap drewc611/generator-tool https://github.com/drewc611/Generator-tool
brew install portamp
```

The formula's `url`/`sha256` are pinned to a real commit rather than a
version tag, because no `v*` tag has been pushed yet (`npm publish` is
waiting on the same thing — see `docs/PUBLISHING.md`). The formula itself
says what to do once a real tag exists: point `url` at that tag's own
tarball and use its own `sha256`, not a guessed one.
