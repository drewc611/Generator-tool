import { flattenRedirects } from "../output-site/index.js";

/**
 * The Google Cloud Platform target for the site engine: the prerendered static
 * export on a Cloud Storage bucket, served through an external HTTPS load
 * balancer with Cloud CDN, and every retired address answered by its real 301
 * at the edge. Like every other host target, this plugin does not port a screen
 * twice and does not invent a redirect. The port already decided the map; this
 * file only spells it in the two places GCP reads it, the load balancer URL map
 * and a plain evidence file beside the Terraform.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any project. The user reviews the Terraform and the deploy
 * script and applies them with their own configured gcloud identity, so nothing
 * here reads, embeds, or prints a key, a service account, a project secret, or
 * a token.
 *
 *   gcp: true
 */
export default {
  name: "output-gcp",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.gcp) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--gcp was asked for and there is no site model to deploy; the GCP target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The redirect map in this host's dialect. This emitter can run before
      // output-site lints the map, so the chains flatten here too; flattening
      // twice is a no-op and a cycle is output-site's to fail loudly. Only
      // redirects that stay inside the site are ours to answer; an offsite
      // destination is not this load balancer's to promise. Sorted by source
      // so two runs write byte identical files.
      const redirects = flattenRedirects(site.redirects)
        .flat.filter((r) => r.to.startsWith("/"))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

      const routes = pages.map((p) => p.route).sort();

      await ctx.write("gcp/main.tf", MAIN_TF(redirects));
      await ctx.write("gcp/redirects.map", REDIRECTS_MAP(redirects));
      await ctx.write("gcp/deploy.sh", DEPLOY_SH);
      await ctx.write("gcp/README.md", README(routes.length, redirects.length));

      log.info(`gcp: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The GCP target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records, the managed TLS certificate, and project specific names are the user's to fill in before terraform apply, an honest gap the plan cannot close for you.");
    });
  },
};

const REDIRECTS_MAP = (redirects) => `# The retired addresses this port keeps alive, one per line as "from to". This
# is the same map the URL map in main.tf encodes as load balancer redirect
# rules, kept beside it as plain evidence a person can read and diff. The map
# came from the site model, not from guesswork, so a redirect here is a
# redirect the pages proved. Sorted by source so two runs write the same bytes.
${redirects.length
  ? redirects.map((r) => `${r.from} ${r.to}`).join("\n")
  : "# No retired addresses in this run, so the load balancer passes every request through."}
`;

const MAIN_TF = (redirects) => `# The port on Google Cloud Platform, declared as infrastructure. This is a plan
# to review and apply with your own credentials; it holds no key and names no
# project. Fill the variables below, then:
#
#   cd gcp && terraform init && terraform plan && terraform apply
#
# The shape is the standard one for a static site: a Cloud Storage bucket holds
# the prerendered export, a backend bucket with Cloud CDN serves it, and an
# external HTTPS load balancer sits in front. The load balancer URL map answers
# every retired address with the same 301 the port enforces everywhere else.

terraform {
  required_version = ">= 1.3.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
}

# The project id, the bucket name and the region are yours to set. The defaults
# are placeholders with no real value; a bucket name is globally unique and a
# project id is your own, so pick them before applying.
variable "project_id" {
  description = "The Google Cloud project to deploy into."
  type        = string
  default     = "my-portamp-project"
}

variable "bucket_name" {
  description = "Globally unique Cloud Storage bucket name for the static site export."
  type        = string
  default     = "my-portamp-site"
}

variable "region" {
  description = "The region for the Cloud Storage bucket."
  type        = string
  default     = "us-central1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# The bucket that holds the prerendered export, configured for website hosting:
# index.html answers the root of every directory and a missing object falls to
# the single page shell, the same contract every other host target keeps.
resource "google_storage_bucket" "site" {
  name     = var.bucket_name
  location = var.region

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }

  uniform_bucket_level_access = true
}

# A backend bucket with Cloud CDN in front of the storage bucket, so the load
# balancer serves the export from the edge.
resource "google_compute_backend_bucket" "site" {
  name        = "\${var.bucket_name}-backend"
  bucket_name = google_storage_bucket.site.name
  enable_cdn  = true
}

# The redirect map, carried at the edge as load balancer redirect rules. Each
# retired address matches its exact old path and answers with a 301 to the new
# one; strip_query is false so a query string survives the move, and the
# response code is the load balancer's own name for a permanent redirect. The
# same map sits in redirects.map beside this file as plain evidence, so a fix
# to the pages lands in both.
resource "google_compute_url_map" "site" {
  name            = "\${var.bucket_name}-urlmap"
  default_service = google_compute_backend_bucket.site.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "allpaths"
  }

  path_matcher {
    name            = "allpaths"
    default_service = google_compute_backend_bucket.site.id
${redirects.length
  ? redirects.map((r) => `
    route_rules {
      priority = ${100 + redirects.indexOf(r)}
      match_rules {
        full_path_match = ${q(r.from)}
      }
      url_redirect {
        path_redirect          = ${q(r.to)}
        strip_query            = false
        redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
      }
    }`).join("\n")
  : "    # No retired addresses in this run, so the URL map only serves the export."}
  }
}

# A managed TLS certificate and a global address are project specific, so the
# plan names them and leaves the domain to you. Fill your own domain in, then
# the certificate provisions once DNS points at the forwarding rule's address.
resource "google_compute_managed_ssl_certificate" "site" {
  name = "\${var.bucket_name}-cert"

  managed {
    # Replace with your own domain before applying; the certificate provisions
    # only once DNS for this name points at the load balancer.
    domains = ["example.com"]
  }
}

resource "google_compute_target_https_proxy" "site" {
  name             = "\${var.bucket_name}-https-proxy"
  url_map          = google_compute_url_map.site.id
  ssl_certificates = [google_compute_managed_ssl_certificate.site.id]
}

resource "google_compute_global_address" "site" {
  name = "\${var.bucket_name}-address"
}

resource "google_compute_global_forwarding_rule" "site" {
  name       = "\${var.bucket_name}-forwarding-rule"
  target     = google_compute_target_https_proxy.site.id
  port_range = "443"
  ip_address = google_compute_global_address.site.address
}

# The evidence: how many redirects this plan carries, so the count is checkable
# against the port's own reports rather than taken on faith.
${redirects.length
  ? redirects.map((r) => `# 301  ${r.from}  ->  ${r.to}   (${r.kind})`).join("\n")
  : "# No retired addresses in this run, so the URL map answers every request from the export."}

output "load_balancer_ip" {
  description = "The global address the site is served from once DNS points at it."
  value       = google_compute_global_address.site.address
}
`;

/** A JSON string literal, safe to drop into HCL source. */
const q = (s) => JSON.stringify(String(s));

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to the bucket Terraform created, then tell
# Cloud CDN to serve the new bytes. This script uses only the gcloud and gsutil
# CLIs and holds no secret of its own: your credentials come from your own
# 'gcloud auth login' or the environment your shell already carries, never from
# portamp. Nothing sensitive is hardcoded here.
#
# Set these before running:
#   BUCKET      the bucket name you gave Terraform (var.bucket_name)
#   URL_MAP     the URL map name Terraform created (bucket_name plus -urlmap)
#   PROJECT     the project id you gave Terraform (var.project_id)
#   EXPORT_DIR  the prerendered export to upload (default: ../export)
set -euo pipefail

: "\${BUCKET:?set BUCKET to the Cloud Storage bucket name you deployed}"
: "\${URL_MAP:?set URL_MAP to the load balancer URL map name}"
: "\${PROJECT:?set PROJECT to your Google Cloud project id}"
EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# Upload the static site. -d removes objects the export no longer holds, so the
# bucket is exactly the port and nothing stale lingers.
gsutil -m rsync -d -r "\$EXPORT_DIR" "gs://\$BUCKET"

# Serve the new bytes now rather than waiting for the edge caches to expire.
gcloud compute url-maps invalidate-cdn-cache "\$URL_MAP" --path "/*" --project "\$PROJECT"

echo "deployed \$EXPORT_DIR to gs://\$BUCKET and invalidated \$URL_MAP"
`;

const README = (routes, redirects) => `# Deploying the port to Google Cloud Platform

This directory holds a deploy plan for the port: the prerendered static export
on a Cloud Storage bucket, served through an external HTTPS load balancer with
Cloud CDN, with every retired address answered by its real 301 at the edge. It
is a plan you review and apply, not an action portamp took. portamp handled no
credentials and named no project; the values you fill in and the identity you
apply with are entirely yours.

## What is here

- \`main.tf\` declares the infrastructure in Terraform: a Cloud Storage bucket
  for the export configured for website hosting, a backend bucket with Cloud
  CDN enabled, a URL map that carries the redirect map, an HTTPS target proxy,
  and a global forwarding rule.
- \`redirects.map\` is that same map as plain \`from to\` lines, human readable
  evidence beside the Terraform the URL map encodes.
- \`deploy.sh\` uploads the export and invalidates the CDN cache using only the
  \`gcloud\` and \`gsutil\` CLIs and your own configured credentials.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then review and apply the infrastructure. Set your own project id, bucket name
and region in \`main.tf\` (the defaults are placeholders) before applying:

\`\`\`bash
cd gcp
terraform init
terraform plan
terraform apply
\`\`\`

Then publish the bytes:

\`\`\`bash
export BUCKET=<the bucket name you set>
export URL_MAP=<the url map name terraform created>
export PROJECT=<your project id>
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where a project begins. DNS records, the managed TLS certificate
for a custom domain, and any project specific naming are yours to add; the
certificate names \`example.com\` as a placeholder and provisions only once your
DNS points at the load balancer address. This is an honest gap: portamp cannot
know your domain, your certificate, or your project, so it declares the parts it
can prove and leaves the rest named rather than guessed.
`;
