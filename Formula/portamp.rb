# A tap formula, not a homebrew-core submission: portamp's licence is
# proprietary, all rights reserved, which homebrew-core does not accept.
# Install with:
#   brew tap drewc611/generator-tool https://github.com/drewc611/Generator-tool
#   brew install portamp
#
# The url/sha256 below are pinned to a real commit rather than a version
# tag, because no v* tag has been pushed yet (npm publish is waiting on
# the same thing, see docs/PUBLISHING.md). Once a real "v*" tag exists,
# point url at its own tarball
# (https://github.com/drewc611/Generator-tool/archive/refs/tags/vX.Y.Z.tar.gz)
# and its own sha256 instead of guessing one, the same restraint the tool
# itself asks of every plugin.
class Portamp < Formula
  desc "Tiny plugin host that ports legacy front ends to React, Vue, Svelte, or a dependency free custom element"
  homepage "https://github.com/drewc611/Generator-tool"
  url "https://github.com/drewc611/Generator-tool/archive/c9d4f6025f4367f179e20e2e87e84a4ca2bfe598.tar.gz"
  sha256 "2ec2717579508774b3848f39dfe7f4165c4044d363d629c6f3bc37af838baeb3"
  license :cannot_represent
  head "https://github.com/drewc611/Generator-tool.git", branch: "main"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"portamp").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/src/cli.js" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/portamp plugins")
    assert_match "plugin(s)", output
  end
end
