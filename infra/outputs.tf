output "resource_group_name" {
  description = "Name of the resource group holding the stack."
  value       = azurerm_resource_group.main.name
}

output "acr_login_server" {
  description = "Registry address used by `az acr build` and by the container apps."
  value       = azurerm_container_registry.main.login_server
}

output "acr_name" {
  description = "Container registry resource name."
  value       = azurerm_container_registry.main.name
}

output "frontend_url" {
  description = "Public dashboard URL."
  value       = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "backend_url" {
  description = "FastAPI URL (health: /api/health, OpenAPI docs: /docs)."
  value       = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "log_analytics_workspace" {
  description = "Workspace that collects container logs."
  value       = azurerm_log_analytics_workspace.main.name
}
