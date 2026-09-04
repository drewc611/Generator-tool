import { flattenRedirects } from "../output-site/index.js";

/**
 * The Microsoft Azure target for the site engine: the prerendered static
 * export on an Azure Storage account static website, served over TLS by Azure
 * Front Door, with every retired address answered by its real 301. Like every
 * other host target, this plugin does not port a screen twice and does not
 * invent a redirect. The port already decided the map; this file only spells
 * it in the two places Azure reads it, a Front Door rules engine and a
 * Terraform declaration of the infrastructure around it.
 *
 * What this emits is a plan, not an action. portamp holds no credentials and
 * makes no call to any subscription. The user reviews the Terraform and the
 * deploy script and applies them with their own configured Azure identity, so
 * nothing here reads, embeds, or prints an account key, a connection string,
 * an access key, a subscription secret, or a token.
 *
 *   azure: true
 */
export default {
  name: "output-azure",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.azure) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--azure was asked for and there is no site model to deploy; the Azure target needs --site true and a folder of pages.");
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

      await ctx.write("azure/main.tf", MAIN_TF(redirects));
      await ctx.write("azure/redirects.map", REDIRECTS_MAP(redirects));
      await ctx.write("azure/deploy.sh", DEPLOY_SH);
      await ctx.write("azure/README.md", README(routes.length, redirects.length));

      log.info(`azure: deploy plan written, ${routes.length} route(s), ${redirects.length} redirect(s)`);

      ctx.unverified("The Azure target emits a deploy plan for review and applies nothing; portamp took no credentials. DNS records, the managed TLS certificate, and subscription specific names are the user's to fill in before terraform apply, an honest gap the plan cannot close for you.");
    });
  },
};

/** A rule name Terraform accepts: a redirect source reduced to letters and
 * digits with a stable ordinal, so two runs name the same rule the same way
 * and nothing about the address leaks into an identifier. */
const ruleName = (i) => `redirect${String(i + 1).padStart(4, "0")}`;

const MAIN_TF = (redirects) => `# The port on Microsoft Azure, declared as infrastructure. This is a plan to
# review and apply with your own credentials; it holds no key, no connection
# string, and names no subscription. Fill the variables below, then:
#
#   cd azure && terraform init && terraform plan && terraform apply
#
# The shape is the standard one for a static site: a Storage account hosts the
# prerendered export as a static website, Azure Front Door serves it over TLS,
# and a Front Door rules engine answers every retired address with the same
# 301 the port enforces everywhere else.

terraform {
  required_version = ">= 1.3.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.0.0"
    }
  }
}

provider "azurerm" {
  features {}
}

# The resource group, the storage account name, and the location are yours to
# set. The defaults are placeholders with no real value; a storage account name
# is globally unique and lowercase, so pick your own before applying.
variable "resource_group_name" {
  description = "Resource group that holds the storage account and Front Door."
  type        = string
  default     = "portamp-rg"
}

variable "storage_account_name" {
  description = "Globally unique, lowercase storage account name for the static site."
  type        = string
  default     = "portampsite"
}

variable "location" {
  description = "Azure region for the resource group and storage account."
  type        = string
  default     = "eastus"
}

resource "azurerm_resource_group" "site" {
  name     = var.resource_group_name
  location = var.location
}

# The storage account whose static website hosts the prerendered export. The
# static_website block turns on the $web container Front Door reads from and
# names the document the site opens at.
resource "azurerm_storage_account" "site" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.site.name
  location                 = azurerm_resource_group.site.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  static_website {
    index_document = "index.html"
  }
}

# Front Door Standard: a profile, an endpoint, and an origin group pointing at
# the storage static website host. The port is served over TLS from the edge,
# and the rules engine below carries the redirect map.
resource "azurerm_cdn_frontdoor_profile" "site" {
  name                = "\${var.storage_account_name}-fd"
  resource_group_name = azurerm_resource_group.site.name
  sku_name            = "Standard_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_endpoint" "site" {
  name                     = "\${var.storage_account_name}-endpoint"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.site.id
}

resource "azurerm_cdn_frontdoor_origin_group" "site" {
  name                     = "\${var.storage_account_name}-origins"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.site.id

  load_balancing {}

  health_probe {
    interval_in_seconds = 100
    path                = "/"
    protocol            = "Https"
    request_type        = "HEAD"
  }
}

# The origin is the storage account's static website host. Terraform reads the
# host from the account resource, so nothing about the account is written here
# by hand.
resource "azurerm_cdn_frontdoor_origin" "site" {
  name                          = "\${var.storage_account_name}-origin"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.site.id

  enabled                        = true
  certificate_name_check_enabled = true
  host_name                      = azurerm_storage_account.site.primary_web_host
  origin_host_header             = azurerm_storage_account.site.primary_web_host
  http_port                      = 80
  https_port                     = 443
  priority                       = 1
  weight                         = 1000
}

# The default route: every request that is not a retired address is served from
# the static website origin.
resource "azurerm_cdn_frontdoor_route" "site" {
  name                          = "\${var.storage_account_name}-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.site.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.site.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.site.id]

  supported_protocols    = ["Http", "Https"]
  patterns_to_match      = ["/*"]
  forwarding_protocol    = "HttpsOnly"
  https_redirect_enabled = true
  link_to_default_domain = true
}

# The redirect map, carried by a Front Door rule set. Each retired address is
# one rule: it matches the request path and issues a permanent (301) redirect
# to the new path. The set is generated from the port's own flattened map, so a
# fix to the pages lands once and every host target moves together.
resource "azurerm_cdn_frontdoor_rule_set" "redirects" {
  name                     = "redirects"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.site.id
}

${redirects.length
  ? redirects.map((r, i) => `# ${r.kind}
resource "azurerm_cdn_frontdoor_rule" "${ruleName(i)}" {
  name                      = "${ruleName(i)}"
  cdn_frontdoor_rule_set_id = azurerm_cdn_frontdoor_rule_set.redirects.id
  order                     = ${i + 1}
  behavior_on_match         = "Stop"

  conditions {
    url_path_condition {
      operator     = "Equal"
      match_values = [${q(r.from)}]
    }
  }

  actions {
    url_redirect_action {
      redirect_type        = "Moved"
      redirect_protocol    = "Https"
      destination_path     = ${q(r.to)}
    }
  }
}`).join("\n\n")
  : "# No retired addresses in this run, so the rule set carries no redirect and every request is served from the origin."}

# The evidence: how many redirects this plan carries, so the count is checkable
# against the port's own reports rather than taken on faith. The same map, plain
# and human readable, sits in redirects.map beside this file.
${redirects.length
  ? redirects.map((r) => `# 301  ${r.from}  ->  ${r.to}   (${r.kind})`).join("\n")
  : "# No retired addresses in this run."}

output "endpoint_host" {
  description = "The Front Door endpoint the site is served from once applied."
  value       = azurerm_cdn_frontdoor_endpoint.site.host_name
}
`;

/** A Terraform string literal, safe to drop into HCL source. */
const q = (s) => JSON.stringify(String(s));

const REDIRECTS_MAP = (redirects) => (redirects.length
  ? redirects.map((r) => `${r.from} ${r.to}`).sort().join("\n") + "\n"
  : "# No retired addresses in this run.\n");

const DEPLOY_SH = `#!/usr/bin/env bash
# Publish the prerendered export to the storage static website Terraform
# created, then purge the Front Door endpoint so the new bytes are served. This
# script uses only the az CLI and holds no secret of its own: your credentials
# come from your own 'az login' or the environment your shell already carries,
# never from portamp. Nothing sensitive is hardcoded here; in particular no
# storage connection string and no account key is written or read.
#
# Set these before running:
#   RESOURCE_GROUP    the resource group you gave Terraform (var.resource_group_name)
#   STORAGE_ACCOUNT   the storage account name (var.storage_account_name)
#   PROFILE           the Front Door profile name
#   ENDPOINT          the Front Door endpoint name
#   EXPORT_DIR        the prerendered export to upload (default: ../export)
set -euo pipefail

: "\${RESOURCE_GROUP:?set RESOURCE_GROUP to the resource group you deployed}"
: "\${STORAGE_ACCOUNT:?set STORAGE_ACCOUNT to the storage account name}"
: "\${PROFILE:?set PROFILE to the Front Door profile name}"
: "\${ENDPOINT:?set ENDPOINT to the Front Door endpoint name}"
EXPORT_DIR="\${EXPORT_DIR:-../export}"

if [ ! -d "\$EXPORT_DIR" ]; then
  echo "no export at \$EXPORT_DIR; run the port with --export true first" >&2
  exit 1
fi

# Upload the static site into the static website container. The az CLI reads
# your logged in identity; no account key is passed on the command line.
az storage blob upload-batch \\
  --account-name "\$STORAGE_ACCOUNT" \\
  --auth-mode login \\
  -d '$web' \\
  -s "\$EXPORT_DIR" \\
  --overwrite

# Serve the new bytes now rather than waiting for the edge caches to expire.
az afd endpoint purge \\
  --resource-group "\$RESOURCE_GROUP" \\
  --profile-name "\$PROFILE" \\
  --endpoint-name "\$ENDPOINT" \\
  --content-paths '/*'

echo "deployed \$EXPORT_DIR to \$STORAGE_ACCOUNT/\\\$web and purged \$ENDPOINT"
`;

const README = (routes, redirects) => `# Deploying the port to Microsoft Azure

This directory holds a deploy plan for the port: the prerendered static export
on an Azure Storage account static website, served over TLS by Azure Front Door
(Standard), with every retired address answered by its real 301 at the edge. It
is a plan you review and apply, not an action portamp took. portamp handled no
credentials and named no subscription; the values you fill in and the identity
you apply with are entirely yours.

## What is here

- \`main.tf\` declares the infrastructure in Terraform: a storage account with a
  static website, an Azure Front Door profile, endpoint, origin group and origin
  reading it, and a Front Door rule set that carries the redirect map, one rule
  per retired address issuing a 301 to the new path.
- \`redirects.map\` is that same map in plain \`from to\` lines, sorted, as human
  readable evidence beside the Terraform.
- \`deploy.sh\` uploads the export and purges the endpoint using only the \`az\`
  CLI and your own logged in credentials; it writes no account key and no
  connection string.

## Apply it

First build the static site the plan serves:

\`\`\`bash
# from the port root
node src/cli.js run --src <your source> --out <this port> --site true --export true
\`\`\`

Then review and apply the infrastructure. Set your own resource group, storage
account name and location in \`main.tf\` (the defaults are placeholders) before
applying:

\`\`\`bash
cd azure
terraform init
terraform plan
terraform apply
\`\`\`

Then publish the bytes:

\`\`\`bash
export RESOURCE_GROUP=<the resource group you set>
export STORAGE_ACCOUNT=<the storage account name you set>
export PROFILE=<the Front Door profile name>
export ENDPOINT=<the Front Door endpoint name>
export EXPORT_DIR=../export
./deploy.sh
\`\`\`

## What the plan hosts

It hosts the prerendered static export, which \`--export true\` writes as plain
HTML per route under \`export/\`. It carries ${routes} route(s) and answers
${redirects} retired address(es) with a 301, the same map every other host
target carries in its own spelling.

## What is yours to fill in

The plan stops where a subscription begins. DNS records, the managed TLS
certificate for a custom domain, and any subscription specific naming are yours
to add; the endpoint serves from its default Front Door hostname until you do.
This is an honest gap: portamp cannot know your domain, your certificate, or
your subscription, so it declares the parts it can prove and leaves the rest
named rather than guessed.
`;
