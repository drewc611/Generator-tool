import { flattenRedirects } from "../output-site/index.js";

/**
 * The Netlify target for the site engine: the prerendered static export hosted
 * on Netlify, with every retired address answered by its real 301. Like every
 * other host target, this plugin does not port a screen twice and does not
 * invent a redirect. The port already decided the map; this file only spells it
 * in the one place Netlify reads it, the native _redirects file.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any account. The user reviews netlify.toml and the deploy
 * script and applies them with their own configured Netlify identity, so
 * nothing here reads, embeds, or prints a key, a token, or a site id.
 *
 *   netlify: true
 */
export default {
  name: "output-netlify",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.netlify) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--netlify was asked for and there is no site model to deploy; the Netlify target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The redirect map in this host's dialect. This emitter can run before
      // output-site lints the map, so the chains flatten here too; flattening
      // twice is a no-op and a cycle is output-site's to fail loudly. Only
      // redirects that stay inside the site are ours to answer; an offsite
      // destination is not this deployment's to promise. Sorted by source so
      // two runs write byte identical files.
      const redirects = flattenRedirects(site.redirects)
        .flat.filter((r) => r.to.startsWith("/"))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

      const routes = pages.map((p) => p.route).sort();

      await ctx.write("netlify/netlify.toml", NETLIFY_TOML);
      await ctx.write("netlify/_redirects", REDIRECTS_FILE(redirects));
      await ctx.write("netlify/deploy.sh", DEPLOY_SH);
      await ctx.write("netlify/README.md", README(routes.length, redirects.length));

      log.info(`netlify: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The Netlify target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records and the Netlify site or account are the user's to set up before netlify deploy, an honest gap the plan cannot close for you.");
    });
  },
};

const NETLIFY_TOML = `# The Netlify config for the port. This is a plan to review and deploy with your
# own credentials; it holds no token and names no site. The publish directory
# points at the prerendered export, which is what Netlify serves; the port has
# no build step and asks for none.
#
#   cd netlify && ./deploy.sh

[build]
  publish = "../export"

# The redirect map lives in the _redirects file beside this config, Netlify's
# own native format, so the map reads as plain lines a person can diff. Netlify
# reads both this config and that file from the publish directory.
`;

const REDIRECTS_FILE = (redirects) => `# Netlify reads this file from the publish directory and answers each retired
# address with a 301. Each line is "from to 301!"; the ! forces the redirect
# even when a file exists at the old path. This map came from the site model,
# not from guesswork, so a line here is a redirect the pages proved. Sorted by
# source so two runs write the same bytes.
${redirects.length
  ? redirects.map((r) => `${r.from}  ${r.to}  301!`).join("\n")
  : "# No retired addresses in this run, so Netlify serves every request from the export."}
`;

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to Netlify. This script uses only the netlify
# CLI and holds no secret of its own: your credentials come from your own
# 'netlify login' or the NETLIFY_AUTH_TOKEN your shell already carries, never
# from portamp. Nothing sensitive is hardcoded here.
#
# Set this before running if the export is elsewhere:
#   EXPORT_DIR  the prerendered export to deploy (default: ../export)
set -euo pipefail

EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# The _redirects file beside this script carries the redirect map, so copy it
# into the export before deploying and Netlify reads it from the publish root.
cp "\$(dirname "\$0")/_redirects" "\$EXPORT_DIR/_redirects"

# Deploy the static export to production. Netlify serves the files as they are;
# the port has no build step and asks for none.
netlify deploy --prod --dir="\$EXPORT_DIR"

echo "deployed \$EXPORT_DIR to Netlify"
`;

const README = (routes, redirects) => `# Deploying the port to Netlify

This directory holds a deploy plan for the port: the prerendered static export
hosted on Netlify, with every retired address answered by its real 301. It is a
plan you review and apply, not an action portamp took. portamp handled no
credentials and named no account; the site you deploy into and the identity you
apply with are entirely yours.

## What is here

- \`netlify.toml\` is the Netlify config: its \`[build] publish\` points at the
  prerendered export, which Netlify serves as it is.
- \`_redirects\` is Netlify's native redirect file, one \`from to 301!\` line per
  retired address, built from the port's own redirect map; the \`!\` forces the
  redirect.
- \`deploy.sh\` copies the redirect file into the export and deploys it using
  only the \`netlify\` CLI and your own configured credentials.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then deploy it:

\`\`\`bash
cd netlify
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

The deploy uses your own \`netlify login\`; portamp holds no token.

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where an account begins. DNS records for a custom domain and the
Netlify site or account itself are yours to set up; the deploy runs against
whichever site your \`netlify\` CLI is linked to. This is an honest gap: portamp
cannot know your domain or your account, so it declares the parts it can prove
and leaves the rest named rather than guessed.
`;
