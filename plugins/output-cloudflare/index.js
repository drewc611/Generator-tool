import { flattenRedirects } from "../output-site/index.js";

/**
 * The Cloudflare target for the site engine: the prerendered static export
 * served by Cloudflare Pages, with every retired address answered by its real
 * 301 at the edge. Like every other host target, this plugin does not port a
 * screen twice and does not invent a redirect. The port already decided the
 * map; this file only spells it in the place Pages reads it, the native
 * _redirects file, so no rule and no worker is needed for the map to hold.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any account. The user reviews the wrangler config and the
 * deploy script and applies them with their own configured wrangler identity,
 * so nothing here reads, embeds, or prints a key, an API token, or an account
 * id.
 *
 *   cloudflare: true
 */
export default {
  name: "output-cloudflare",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.cloudflare) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--cloudflare was asked for and there is no site model to deploy; the Cloudflare target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The redirect map in this host's dialect. This emitter can run before
      // output-site lints the map, so the chains flatten here too; flattening
      // twice is a no-op and a cycle is output-site's to fail loudly. Only
      // redirects that stay inside the site are ours to answer; an offsite
      // destination is not this project's to promise. Sorted by source so two
      // runs write byte identical files.
      const redirects = flattenRedirects(site.redirects)
        .flat.filter((r) => r.to.startsWith("/"))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

      const routes = pages.map((p) => p.route).sort();

      await ctx.write("cloudflare/_redirects", REDIRECTS_FILE(redirects));
      await ctx.write("cloudflare/wrangler.toml", WRANGLER_TOML);
      await ctx.write("cloudflare/deploy.sh", DEPLOY_SH);
      await ctx.write("cloudflare/README.md", README(routes.length, redirects.length));

      log.info(`cloudflare: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The Cloudflare target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records, the custom domain, and account specific names are the user's to fill in before wrangler pages deploy, an honest gap the plan cannot close for you.");
    });
  },
};

const REDIRECTS_FILE = (redirects) => `${redirects.length
  ? redirects.map((r) => `${r.from}  ${r.to}  301`).join("\n")
  : "# No retired addresses in this run, so Cloudflare Pages serves every request from the export."}
`;

const WRANGLER_TOML = `# The port on Cloudflare Pages, declared for the wrangler CLI. This is a plan to
# review and apply with your own credentials; it holds no token and names no
# account. The name below is a placeholder for your own Pages project; pick your
# own before applying.
#
# Pages serves the prerendered static export directly, and reads the _redirects
# file beside it to answer every retired address with a 301 at the edge. No
# worker and no build step is needed: the port has no dependencies and _redirects
# is Cloudflare's own native redirect format.
#
#   cd cloudflare && PROJECT=my-portamp-site ./deploy.sh

name = "my-portamp-site"
pages_build_output_dir = "../export"
compatibility_date = "2024-01-01"
`;

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to Cloudflare Pages. This script uses only the
# wrangler CLI and holds no secret of its own: your credentials come from your
# own 'wrangler login' or the CLOUDFLARE_API_TOKEN your shell already carries,
# never from portamp. Nothing sensitive is hardcoded here.
#
# Set these before running:
#   PROJECT     the Pages project name (matches name in wrangler.toml)
#   EXPORT_DIR  the prerendered export to upload (default: ../export)
set -euo pipefail

: "\${PROJECT:?set PROJECT to your Cloudflare Pages project name}"
EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# The _redirects file beside this script is the map Pages reads at the edge.
# Copy it into the export so it ships with the static bytes.
cp _redirects "\$EXPORT_DIR/_redirects"

# Upload the static site. wrangler reads your own configured credentials; this
# script passes none.
wrangler pages deploy "\$EXPORT_DIR" --project-name="\$PROJECT"

echo "deployed \$EXPORT_DIR to Cloudflare Pages project \$PROJECT"
`;

const README = (routes, redirects) => `# Deploying the port to Cloudflare Pages

This directory holds a deploy plan for the port: the prerendered static export
served by Cloudflare Pages, with every retired address answered by its real 301
at the edge. It is a plan you review and apply, not an action portamp took.
portamp handled no credentials and named no account; the values you fill in and
the identity you apply with are entirely yours.

## What is here

- \`_redirects\` is the redirect map in Cloudflare's own native format: one
  \`FROM  TO  301\` line per retired address, sorted by source. Pages reads this
  file at the edge with no worker and no config, so the map holds the moment the
  bytes are uploaded.
- \`wrangler.toml\` is the wrangler config for a Pages project: a placeholder
  name for your own project and the export directory it serves.
- \`deploy.sh\` copies \`_redirects\` into the export and uploads it with only the
  \`wrangler\` CLI and your own configured credentials.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then set your own project name in \`wrangler.toml\` (the default is a placeholder)
and, if you have not already, sign in so wrangler holds your credentials:

\`\`\`bash
wrangler login
\`\`\`

Then publish the bytes:

\`\`\`bash
cd cloudflare
export PROJECT=<the project name you set>
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where an account begins. DNS records, a custom domain, and any
account specific naming are yours to add in the Cloudflare dashboard or with your
own wrangler identity. This is an honest gap: portamp cannot know your domain or
your account, so it declares the parts it can prove and leaves the rest named
rather than guessed. No credential of any kind appears in this plan; you apply it
with your own \`wrangler login\`.
`;
