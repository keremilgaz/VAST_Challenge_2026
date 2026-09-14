resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name_suffix}"
  location = var.location
  tags     = local.tags
}

# Identity the Container Apps use to pull images from ACR.
# Managed identity instead of admin user/password, so the registry admin account stays disabled.
resource "azurerm_user_assigned_identity" "apps" {
  name                = "id-${local.name_suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags
}
