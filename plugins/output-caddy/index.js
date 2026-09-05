import { flattenRedirects } from "../output-site/index.js";

/**
 * The Caddy target for the site engine: the static export served by Caddy, the
 * server that gets its own TLS with no configuration, with every retired
 * address answered by its real 301. Like output-nginx, the port is the source
 * of truth for the redirect map; this file only spells that same map in Caddy's
 * own dialect, so a fix to the pages lands once and every host target carries
 * it.
 *
 * There is nothing to port twice here. The prerendered HTML the run already
 * wrote is what Caddy serves; this plugin adds the Caddyfile that puts it
 * online and keeps the old links alive.
 *
 *   caddy: true
 */
export default {
  name: "output-caddy",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.caddy) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--caddy was asked for and there is no site model to serve; the Caddy target needs --site true and a folder of pages.");
        return;
      }
      const pages = ctx.site.pages;

      // The redirect map in Caddy's spelling. This emitter can run before
      // output-site lints the map, so the chains flatten here too; flattening
      // twice is a no-op and a cycle is output-site's to fail loudly. Only
      // redirects that stay inside the site become redir directives; an offsite
      // destination is not this server's to promise.
      const redirects = flattenRedirects(ctx.site.redirects).flat.filter((r) => r.to.startsWith("/"));

      await ctx.write("caddy/Caddyfile", CADDYFILE(redirects));
      await ctx.write("caddy/Dockerfile", DOCKERFILE);
      await ctx.write("caddy/README.md", README(pages.length, redirects.length));

      log.info(`caddy: Caddyfile written, ${redirects.length} redirect(s) as redir 301`);
    });
  },
};

const CADDYFILE = (redirects) => `# The port, served by Caddy. Point the root at the static export
# (--export true prerenders every route to plain HTML) and this site block does
# the rest: it answers every retired address with the real 301 the app
# enforces, and falls the client routes back to the single page shell. Caddy
# gets its own HTTPS certificate automatically, so swap :80 for your domain and
# it serves over TLS with nothing else to configure.
#
# The redirect map here is the same one every other host target carries; it
# came from the site model, not from guesswork, so a redirect Caddy returns is
# a redirect the pages proved.
:80 {
	root * /srv
	encode gzip

	# A couple of safe defaults. Content type sniffing off keeps a mislabelled
	# asset from being run as something it is not.
	header X-Content-Type-Options nosniff
	header Referrer-Policy strict-origin-when-cross-origin

	# Hashed assets are named by their bytes, so they can be cached forever; a
	# plain asset is left to Caddy's defaults rather than assumed immutable.
	@immutable path_regexp immutable -[0-9a-f]{8,}\\.[a-z0-9]+$
	header @immutable Cache-Control "public, max-age=31536000, immutable"

${redirects.length
  ? redirects.map((r) => `\t# ${r.kind}\n\tredir ${r.from} ${r.to} 301`).join("\n")
  : "\t# No retired addresses in this run, so no redirects to answer."}

	# The single page shell answers every client route: a path with no file
	# falls back to index.html, where the router resolves it.
	try_files {path} {path}/ /index.html
	file_server
}
`;

const DOCKERFILE = `# The port in a container: Caddy over the static export, with the Caddyfile
# above wired in. Build the export first (npm run build or the --export output
# under export/), then:
#
#   docker build -t ported-site -f caddy/Dockerfile .
#   docker run -p 8080:80 ported-site
#
FROM caddy:alpine

# The prerendered site. Swap export/ for your build output if you serve the
# bundled app instead of the static export.
COPY export/ /srv/

# The site block, including every 301 the port enforces.
COPY caddy/Caddyfile /etc/caddy/Caddyfile
`;

const README = (routes, redirects) => `# Serving the port with Caddy

This directory holds a Caddyfile that serves the port and keeps every old
address working, with automatic HTTPS thrown in.

\`Caddyfile\` serves the static export. Run the port with \`--export true\`
first, which prerenders every route to plain HTML under \`export/\`, then point
Caddy's root at it (the block uses \`/srv\`). Every retired address answers with
the same 301 the app itself enforces, and any client route with no file on disk
falls back to \`index.html\` so the router can resolve it.

To serve over HTTPS, replace \`:80\` with your domain name; Caddy provisions and
renews the certificate on its own. To run it in a container, \`Dockerfile\`
copies the export into \`/srv\` and the Caddyfile into place; build and run it
from the repository root.

The redirect map here is not invented: it is the flattened map the run
produced, the same one \`nginx.conf\`, \`_redirects\`, \`vercel.json\` and
\`netlify.toml\` carry in their own spellings. Fix a redirect at its source and
rerun, and every one of these files moves together.

Routes served: ${routes}. Redirects answered: ${redirects}.
`;
