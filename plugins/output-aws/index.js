import { flattenRedirects } from "../output-site/index.js";

/**
 * The Amazon Web Services target for the site engine: the prerendered static
 * export on S3 behind CloudFront, with every retired address answered by its
 * real 301. Like every other host target, this plugin does not port a screen
 * twice and does not invent a redirect. The port already decided the map; this
 * file only spells it in the two places AWS reads it, a CloudFront Function at
 * the edge and a Terraform declaration of the infrastructure around it.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any account. The user reviews the Terraform and the deploy
 * script and applies them with their own configured AWS identity, so nothing
 * here reads, embeds, or prints a key, a secret, or an account id.
 *
 *   aws: true
 */
export default {
  name: "output-aws",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.aws) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--aws was asked for and there is no site model to deploy; the AWS target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The redirect map in this host's dialect. This emitter can run before
      // output-site lints the map, so the chains flatten here too; flattening
      // twice is a no-op and a cycle is output-site's to fail loudly. Only
      // redirects that stay inside the site are ours to answer; an offsite
      // destination is not this distribution's to promise. Sorted by source so
      // two runs write byte identical files.
      const redirects = flattenRedirects(site.redirects)
        .flat.filter((r) => r.to.startsWith("/"))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

      const routes = pages.map((p) => p.route).sort();

      await ctx.write("aws/main.tf", MAIN_TF(redirects));
      await ctx.write("aws/cloudfront-redirects.js", CLOUDFRONT_FN(redirects));
      await ctx.write("aws/deploy.sh", DEPLOY_SH);
      await ctx.write("aws/README.md", README(routes.length, redirects.length));

      log.info(`aws: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The AWS target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records, the ACM certificate, and account specific names are the user's to fill in before terraform apply, an honest gap the plan cannot close for you.");
    });
  },
};

/** A JSON string literal, safe to drop into JS or HCL source. */
const q = (s) => JSON.stringify(String(s));

const MAIN_TF = (redirects) => `# The port on Amazon Web Services, declared as infrastructure. This is a plan
# to review and apply with your own credentials; it holds no key and names no
# account. Fill the variables below, then:
#
#   cd aws && terraform init && terraform plan && terraform apply
#
# The shape is the standard one for a static site: an S3 bucket holds the
# prerendered export, a CloudFront distribution serves it over TLS, and a
# CloudFront Function at the edge answers every retired address with the same
# 301 the port enforces everywhere else.

terraform {
  required_version = ">= 1.3.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }
}

# The bucket name and the region are yours to set. The defaults are
# placeholders with no real value; a bucket name is globally unique, so pick
# your own before applying.
variable "bucket_name" {
  description = "Globally unique S3 bucket name for the static site export."
  type        = string
  default     = "my-portamp-site"
}

variable "aws_region" {
  description = "AWS region for the S3 bucket."
  type        = string
  default     = "us-east-1"
}

provider "aws" {
  region = var.aws_region
}

# The bucket that holds the prerendered export. CloudFront reads it through an
# origin access control, so the bucket itself stays private and is not a public
# website endpoint.
resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "\${var.bucket_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The redirect map, carried at the edge. The function body lives in
# cloudfront-redirects.js beside this file; keeping the two in step is why both
# are generated from the same flattened map. Fix a redirect at its source and
# rerun, and this table and that file move together.
resource "aws_cloudfront_function" "redirects" {
  name    = "\${var.bucket_name}-redirects"
  runtime = "cloudfront-js-2.0"
  comment = "Answers every retired address with its 301, from the port's own redirect map."
  publish = true
  code    = file("\${path.module}/cloudfront-redirects.js")
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-\${var.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-\${var.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"

    # The redirect map runs on every viewer request, before the cache, so a
    # retired address is answered without ever reaching the origin.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.redirects.arn
    }

    # CachingOptimized, the managed policy id AWS ships. Named here so the plan
    # is self contained and does not depend on a lookup you have to remember.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # A client route with no object on disk falls back to the single page shell,
  # the same contract every other host target keeps.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # A certificate and a domain are account specific, so the plan uses the
  # CloudFront default certificate and leaves the custom domain to you. Add an
  # aliases block and an acm_certificate_arn when your DNS and certificate are
  # ready.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# The evidence: how many routes and redirects this plan carries, so the count
# is checkable against the port's own reports rather than taken on faith.
${redirects.length
  ? redirects.map((r) => `# 301  ${r.from}  ->  ${r.to}   (${r.kind})`).join("\n")
  : "# No retired addresses in this run, so the edge function passes every request through."}

output "distribution_domain" {
  description = "The CloudFront domain the site is served from once applied."
  value       = aws_cloudfront_distribution.site.domain_name
}
`;

const CLOUDFRONT_FN = (redirects) => `// A CloudFront Function, run at the edge on every viewer request. It reads the
// requested path, looks it up in the redirect table below, and returns a 301
// to the new path when the old one matches; anything else passes through to
// the origin untouched.
//
// The table is a plain frozen object built from the port's flattened redirect
// map. The lookup is a single object read, not a regular expression, so there
// is no pattern to backtrack and no expression to evaluate. This file is
// generated; edit the pages and rerun rather than editing here, so this table
// stays in step with the Terraform beside it.
var REDIRECTS = Object.freeze({
${redirects.map((r) => `  ${q(r.from)}: ${q(r.to)}`).join(",\n")}
});

function handler(event) {
  var request = event.request;
  var target = REDIRECTS[request.uri];
  if (target) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        "location": { value: target }
      }
    };
  }
  return request;
}
`;

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to the bucket Terraform created, then tell
# CloudFront to serve the new bytes. This script uses only the aws CLI and
# holds no secret of its own: your credentials come from your own
# 'aws configure' or the AWS_* environment your shell already carries, never
# from portamp. Nothing sensitive is hardcoded here.
#
# Set these before running:
#   BUCKET            the bucket name you gave Terraform (var.bucket_name)
#   DISTRIBUTION_ID   the CloudFront distribution id Terraform created
#   EXPORT_DIR        the prerendered export to upload (default: ../export)
set -euo pipefail

: "\${BUCKET:?set BUCKET to the S3 bucket name you deployed}"
: "\${DISTRIBUTION_ID:?set DISTRIBUTION_ID to the CloudFront distribution id}"
EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# Upload the static site. --delete removes objects the export no longer holds,
# so the bucket is exactly the port and nothing stale lingers.
aws s3 sync "\$EXPORT_DIR" "s3://\$BUCKET" --delete

# Serve the new bytes now rather than waiting for the edge caches to expire.
aws cloudfront create-invalidation --distribution-id "\$DISTRIBUTION_ID" --paths "/*"

echo "deployed \$EXPORT_DIR to s3://\$BUCKET and invalidated \$DISTRIBUTION_ID"
`;

const README = (routes, redirects) => `# Deploying the port to Amazon Web Services

This directory holds a deploy plan for the port: the prerendered static export
on S3, served over TLS by CloudFront, with every retired address answered by
its real 301 at the edge. It is a plan you review and apply, not an action
portamp took. portamp handled no credentials and named no account; the values
you fill in and the identity you apply with are entirely yours.

## What is here

- \`main.tf\` declares the infrastructure in Terraform: a private S3 bucket for
  the export, a CloudFront distribution reading it through an origin access
  control, and a CloudFront Function that carries the redirect map.
- \`cloudfront-redirects.js\` is that function: it looks each requested path up
  in a frozen table built from the port's own redirect map and returns a 301
  when the old address matches, else passes the request through.
- \`deploy.sh\` uploads the export and invalidates the distribution using only
  the \`aws\` CLI and your own configured credentials.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then review and apply the infrastructure. Set your own bucket name and region
in \`main.tf\` (the defaults are placeholders) before applying:

\`\`\`bash
cd aws
terraform init
terraform plan
terraform apply
\`\`\`

Then publish the bytes:

\`\`\`bash
export BUCKET=<the bucket name you set>
export DISTRIBUTION_ID=<the id terraform printed>
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where an account begins. DNS records, an ACM certificate for a
custom domain, and any account specific naming are yours to add; the
distribution uses the CloudFront default certificate until you do. This is an
honest gap: portamp cannot know your domain or your certificate, so it declares
the parts it can prove and leaves the rest named rather than guessed.
`;
