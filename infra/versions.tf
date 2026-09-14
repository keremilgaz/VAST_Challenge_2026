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

  # Remote state.
  # The first run uses local state. After `infra/bootstrap` has been applied,
  # uncomment the block below with the values it outputs and run
  # `terraform init -migrate-state`.
  #
  # backend "azurerm" {
  #   resource_group_name  = "rg-vast-tfstate-frc"
  #   storage_account_name = "sttfstatevastXXXXX"
  #   container_name       = "tfstate"
  #   key                  = "vast/dev.tfstate"
  #   use_azuread_auth     = true
  # }
}
