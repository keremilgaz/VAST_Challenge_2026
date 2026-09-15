# Persistent Azure Files share backing Neo4j's /data directory, so the graph
# survives container restarts.
resource "azurerm_storage_account" "main" {
  name                     = "st${local.compact_name}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false

  tags = local.tags
}

resource "azurerm_storage_share" "neo4j_data" {
  name               = "neo4j-data"
  storage_account_id = azurerm_storage_account.main.id
  quota              = 5 # GiB
}

resource "azurerm_container_app_environment_storage" "neo4j_data" {
  name                         = "neo4j-data"
  container_app_environment_id = azurerm_container_app_environment.main.id
  account_name                 = azurerm_storage_account.main.name
  share_name                   = azurerm_storage_share.neo4j_data.name
  access_key                   = azurerm_storage_account.main.primary_access_key
  access_mode                  = "ReadWrite"
}
