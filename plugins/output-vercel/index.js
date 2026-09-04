import { flattenRedirects } from "../output-site/index.js";

/**
 * The Vercel target for the site engine: the prerendered static export hosted
 * on Vercel, with every retired address answered by its real 301. Like every
 * other host target, this plugin does not port a screen twice and does not
 * invent a redirect. The port already decided the map; this file only spells it
 * in the one place Vercel reads it, the redirects array of vercel.json.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any account. The user reviews vercel.json and the deploy
 * script and applies them with their own configured Vercel identity, so nothing
 * here reads, embeds, or prints a key, a token, or a team id.
 *
 *   vercel: true
 */
export default {
  name: "output-vercel",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.vercel) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--vercel was asked for and there is no site model to deploy; the Vercel target needs --site true and a folder of pages.");
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

      await ctx.write("vercel/vercel.json", VERCEL_JSON(redirects));
      await ctx.write("vercel/deploy.sh", DEPLOY_SH);
      await ctx.write("vercel/README.md", README(routes.length, redirects.length));

      log.info(`vercel: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The Vercel target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records and the Vercel project or account are the user's to set up before vercel deploy, an honest gap the plan cannot close for you.");
    });
  },
};

const VERCEL_JSON = (redirects) => {
  // A permanent redirect is a 301; Vercel reads that from permanent: true. The
  // object is assembled in memory and printed with JSON.stringify, so the file
  // is valid JSON with no hand spelled escaping. Sorted by source above so the
  // array order is stable across runs.
  const config = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    cleanUrls: true,
    trailingSlash: false,
    redirects: redirects.map((r) => ({
      source: r.from,
      destination: r.to,
      permanent: true,
    })),
  };
  return JSON.stringify(config, null, 2) + "\n";
};

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to Vercel. This script uses only the vercel
# CLI and holds no secret of its own: your credentials come from your own
# 'vercel login' or the VERCEL_TOKEN your shell already carries, never from
# portamp. Nothing sensitive is hardcoded here.
#
# Set this before running if the export is elsewhere:
#   EXPORT_DIR  the prerendered export to deploy (default: ../export)
set -euo pipefail

EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# The vercel.json beside this script carries the redirect map, so copy it in
# next to the export before deploying and Vercel reads it as the project config.
cp "\$(dirname "\$0")/vercel.json" "\$EXPORT_DIR/vercel.json"

# Deploy the static export to production. Vercel serves the files as they are;
# the port has no build step and asks for none.
vercel deploy "\$EXPORT_DIR" --prod

echo "deployed \$EXPORT_DIR to Vercel"
`;

const README = (routes, redirects) => `# Deploying the port to Vercel

This directory holds a deploy plan for the port: the prerendered static export
hosted on Vercel, with every retired address answered by its real 301. It is a
plan you review and apply, not an action portamp took. portamp handled no
credentials and named no account; the project you deploy into and the identity
you apply with are entirely yours.

## What is here

- \`vercel.json\` is the Vercel project config: it serves the static export and
  carries a \`redirects\` array built from the port's own redirect map, one
  entry per retired address with \`permanent: true\`, which is Vercel's spelling
  of a 301.
- \`deploy.sh\` copies that config beside the export and deploys it using only
  the \`vercel\` CLI and your own configured credentials.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then deploy it:

\`\`\`bash
cd vercel
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

The deploy uses your own \`vercel login\`; portamp holds no token.

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where an account begins. DNS records for a custom domain and the
Vercel project or account itself are yours to set up; the deploy runs under
whichever project your \`vercel\` CLI is linked to. This is an honest gap:
portamp cannot know your domain or your account, so it declares the parts it can
prove and leaves the rest named rather than guessed.
`;
