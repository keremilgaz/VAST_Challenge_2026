# Chicken-and-egg layer for remote state.
# This small configuration keeps its own state LOCAL; its only job is to create
# the storage account that holds the state of the main configuration.
#
#   cd infra/bootstrap
#   terraform init && terraform apply
#   -> copy the output into the backend block in infra/versions.tf
#   cd .. && terraform init -migrate-state

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.30"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

variable "subscription_id" {
  description = "Azure subscription ID."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "francecentral"
}

variable "project" {
  description = "Short project code."
  type        = string
  default     = "vast"
}

resource "random_string" "suffix" {
  length  = 5
  lower   = true
  upper   = false
  numeric = true
  special = false
}

locals {
  tags = {
    project     = var.project
    environment = "shared"
    owner       = "kerem.ilgaz"
    managed_by  = "terraform"
    purpose     = "terraform-remote-state"
  }
}

resource "azurerm_resource_group" "tfstate" {
  name     = "rg-${var.project}-tfstate-frc"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "tfstate" {
  name                     = "sttfstate${var.project}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.tfstate.name
  location                 = azurerm_resource_group.tfstate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = true

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 14
    }
  }

  tags = local.tags
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

output "state_storage_account_id" {
  description = "Scope for the Storage Blob Data Contributor role assignment."
  value       = azurerm_storage_account.tfstate.id
}

output "backend_config" {
  description = "Values to paste into the backend block of infra/versions.tf."
  value       = <<-EOT
    backend "azurerm" {
      resource_group_name  = "${azurerm_resource_group.tfstate.name}"
      storage_account_name = "${azurerm_storage_account.tfstate.name}"
      container_name       = "${azurerm_storage_container.tfstate.name}"
      key                  = "${var.project}/dev.tfstate"
      use_azuread_auth     = true
    }
  EOT
}
