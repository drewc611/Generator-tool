/**
 * A container for the port the site engine already produced. output-site
 * writes a zero dependency serve.js that answers every old address with its
 * real 301, serves the assets as bytes, replies to /healthz, and speaks the
 * API surface honestly. This plugin only wraps that server in an image, so
 * the port travels the way everything else deploys now without learning a
 * build step it does not have.
 *
 * The port carries no runtime dependencies and no build, so the image is a
 * base runtime, the port copied in, and the server started. There is nothing
 * to install and nothing to compile, and the Dockerfile says so where a
 * reader expects the npm install that is deliberately absent.
 *
 *   dockerfile: true
 */
export default {
  name: "output-dockerfile",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.dockerfile) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--dockerfile was asked for and there is no site model to containerize; the Docker target needs --site true and a folder of pages.");
        return;
      }

      await ctx.write("Dockerfile", DOCKERFILE);
      await ctx.write(".dockerignore", DOCKERIGNORE);
      await ctx.write("docker-compose.yml", COMPOSE);
      await ctx.write("deploy/README.md", DEPLOY_README);

      log.info("dockerfile: Dockerfile, .dockerignore, docker-compose.yml and deploy/README.md written; the image serves the port through serve.js");
    });
  },
};

// EXPOSE and the compose port both name 4173 to match serve.js's default.
// serve.js reads PORT when it is set, so the env var here is the one knob and
// the default holds when nobody turns it.
const PORT = 4173;

const DOCKERFILE = `# The port in a container. serve.js is a zero dependency server that answers
# every old address, serves the assets, replies to /healthz, and speaks the
# API surface; the image only wraps it.
FROM node:20-alpine

WORKDIR /app

# The port declares no runtime dependencies, so there is no npm install: the
# files copied here are the whole application. Copying the tree in is the
# entire build.
COPY . .

# serve.js listens on PORT and falls back to ${PORT} when it is unset, so the
# image binds ${PORT} by default and the same knob moves it.
ENV PORT=${PORT}
EXPOSE ${PORT}

# serve.js answers /healthz, so the container can prove itself alive without a
# probe that knows a single route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -q -O - http://localhost:\${PORT}/healthz || exit 1

CMD ["node", "serve.js"]
`;

const DOCKERIGNORE = `# The image ships the running port and nothing the run wrote to explain it.
# The reports, the ledgers and the notes are evidence for a person reading the
# port, not files the server reads, so they stay out of the layer.
node_modules
.git
.gitignore
.portamp/
*.md
LEDGER.json
PORT_NOTES.md

# The tests run against the port; they are not part of what the container
# serves.
test/
tests/
`;

const COMPOSE = `# One service: build the Dockerfile beside it and serve the port. The port
# mapping and the PORT env agree on ${PORT}, the same number serve.js defaults
# to, so moving the port is one edit in one place.
services:
  site:
    build: .
    ports:
      - "${PORT}:${PORT}"
    environment:
      - PORT=${PORT}
    restart: unless-stopped
`;

const DEPLOY_README = `# Deploying the port as a container

The site engine wrote a complete application here and a zero dependency
\`serve.js\` beside it. That server is the whole runtime: it answers every old
address with its real 301, serves the assets as bytes, replies to
\`/healthz\`, and answers the API surface honestly. The image in this port only
wraps that server, so what the container serves is exactly what
\`npm run serve\` serves, redirects and all.

## Build and run

\`\`\`bash
docker build -t ported-site .
docker run -p ${PORT}:${PORT} ported-site
\`\`\`

The site is then at http://localhost:${PORT}.

There is no build step and no \`npm install\`: the port declares no runtime
dependencies, so the image is the base Node runtime with the port copied in
and \`node serve.js\` started. Do not add an install or a bundler here; the
port does not use one, and inventing one would be a claim the port cannot
back.

## The port

Set \`PORT\` to serve on another port; \`serve.js\` reads it and falls back to
${PORT} when it is unset. The published port in the run command must match.

\`\`\`bash
docker run -e PORT=8080 -p 8080:8080 ported-site
\`\`\`

## Compose

\`docker-compose.yml\` builds this same Dockerfile and maps the port for you:

\`\`\`bash
docker compose up --build
\`\`\`

## Health

The container's \`HEALTHCHECK\` hits \`/healthz\`, which \`serve.js\` answers, so
an orchestrator can tell a live container from a dead one without knowing any
route the site defines.
`;
