locals {
  # Naming convention: <type>-<project>-<environment>-<region short code>
  # e.g. rg-vast-dev-weu, ca-vast-dev-api, log-vast-dev-weu
  location_short = lookup({
    francecentral      = "frc"
    westeurope         = "weu"
    northeurope        = "neu"
    germanywestcentral = "gwc"
    swedencentral      = "sdc"
  }, var.location, substr(var.location, 0, 3))

  name_prefix = "${var.project}-${var.environment}"
  name_suffix = "${local.name_prefix}-${local.location_short}"

  # For resources that require a globally unique, alphanumeric-only name
  # (container registry, storage account).
  compact_name = "${var.project}${var.environment}${random_string.suffix.result}"

  # Tag set applied to every resource.
  tags = merge(
    {
      project     = var.project
      environment = var.environment
      owner       = var.owner
      cost_center = var.cost_center
      managed_by  = "terraform"
      repository  = "keremilgaz/VAST_Challenge_2026"
    },
    var.extra_tags
  )
}

resource "random_string" "suffix" {
  length  = 5
  lower   = true
  upper   = false
  numeric = true
  special = false
}
