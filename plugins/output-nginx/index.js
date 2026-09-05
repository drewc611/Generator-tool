import { flattenRedirects } from "../output-site/index.js";

/**
 * The nginx target for the site engine: the static export served by the
 * server most old sites already sat behind, with every retired address
 * answered by its real 301. The port itself is the source of truth for the
 * redirect map; this file only spells that same map in nginx's own dialect,
 * so a fix to the pages lands once and every host target carries it.
 *
 * There is nothing to port twice here. The components and the prerendered
 * HTML the run already wrote are what nginx serves; this plugin adds the
 * server block that puts them online and keeps the old links alive.
 *
 *   nginx: true
 */
export default {
  name: "output-nginx",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.nginx) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--nginx was asked for and there is no site model to serve; the nginx target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The redirect map, in this host's spelling. This emitter can run
      // before output-site lints the map, so the chains flatten here too;
      // flattening twice is a no-op and a cycle is output-site's to fail
      // loudly. Only redirects that stay inside the site become location
      // blocks; an offsite destination is not this server's to promise.
      const redirects = flattenRedirects(site.redirects).flat.filter((r) => r.to.startsWith("/"));

      await ctx.write("nginx/nginx.conf", CONF(redirects));
      await ctx.write("nginx/Dockerfile", DOCKERFILE);
      await ctx.write("nginx/README.md", README(pages.length, redirects.length));

      log.info(`nginx: server block written, ${redirects.length} redirect(s) as return 301`);
    });
  },
};

const CONF = (redirects) => `# The port, served by nginx. Point the root at the static export
# (--export true prerenders every route to plain HTML) and this block does
# the rest: it answers every retired address with the real 301 the app
# enforces, and falls the client routes back to the single page shell.
#
# The redirect map here is the same one every other host target carries; it
# came from the site model, not from guesswork, so a redirect nginx returns
# is a redirect the pages proved.
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # A couple of safe defaults. Content type sniffing off keeps a
    # mislabelled asset from being run as something it is not.
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # Hashed assets are named by their bytes, so they can be cached forever;
    # a plain asset is left to nginx's defaults rather than assumed immutable.
    location ~* -[0-9a-f]{8,}\\.[a-z0-9]+$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

${redirects.length
  ? redirects.map((r) => `    # ${r.kind}\n    location = ${r.from} { return 301 ${r.to}; }`).join("\n")
  : "    # No retired addresses in this run, so no redirects to answer."}

    # The single page shell answers every client route: a path with no file
    # falls back to index.html, where the router resolves it.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

const DOCKERFILE = `# The port in a container: nginx over the static export, with the server
# block above wired in. Build the export first (npm run build or the
# --export output under export/), then:
#
#   docker build -t ported-site -f nginx/Dockerfile .
#   docker run -p 8080:80 ported-site
#
FROM nginx:alpine

# The prerendered site. Swap export/ for your build output if you serve the
# bundled app instead of the static export.
COPY export/ /usr/share/nginx/html/

# The server block, including every 301 the port enforces.
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
`;

const README = (routes, redirects) => `# Serving the port with nginx

This directory holds an nginx server block that serves the port and keeps
every old address working.

\`nginx.conf\` serves the static export. Run the port with \`--export true\`
first, which prerenders every route to plain HTML under \`export/\`, then
point nginx's root at it (the block uses \`/usr/share/nginx/html\`). Every
retired address answers with the same 301 the app itself enforces, and any
client route with no file on disk falls back to \`index.html\` so the router
can resolve it.

To use the config directly, copy \`nginx.conf\` into
\`/etc/nginx/conf.d/default.conf\` (or include it from your \`http\` block)
and reload nginx. To run it in a container, \`Dockerfile\` copies the export
into the html root and the config into place; build and run it from the
repository root.

The redirect map here is not invented: it is the flattened map the run
produced, the same one \`_redirects\`, \`vercel.json\` and \`netlify.toml\`
carry in their own spellings. Fix a redirect at its source and rerun, and
every one of these files moves together.

Routes served: ${routes}. Redirects answered: ${redirects}.
`;
