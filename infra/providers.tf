provider "azurerm" {
  subscription_id = var.subscription_id

  features {
    resource_group {
      # Do not leave an empty resource group behind after `terraform destroy`.
      prevent_deletion_if_contains_resources = false
    }
  }
}
