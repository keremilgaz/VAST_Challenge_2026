# ---------------------------------------------------------------------------
# api: FastAPI backend + Neo4j (two containers in the same replica)
#
# Why one app with two containers?
# Containers in the same Container Apps template share a network namespace,
# so the backend reaches Neo4j over bolt://localhost:7687 and the database is
# never exposed to the internet. Splitting them into two apps would require
# TCP ingress on a custom VNet. A real production setup would move Neo4j to a
# managed service (AuraDB) or a dedicated VM; the goal here is to mirror the
# docker-compose topology one to one.
# ---------------------------------------------------------------------------
resource "azurerm_container_app" "api" {
  name                         = "ca-${local.name_prefix}-api"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.apps.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.apps.id
  }

  secret {
    name  = "neo4j-auth"
    value = "neo4j/${var.neo4j_password}"
  }

  secret {
    name  = "neo4j-password"
    value = var.neo4j_password
  }

  template {
    min_replicas = var.backend_min_replicas
    max_replicas = 1

    volume {
      name         = "neo4j-data"
      storage_name = azurerm_container_app_environment_storage.neo4j_data.name
      storage_type = "AzureFile"
    }

    container {
      name   = "neo4j"
      image  = "neo4j:5.26.4"
      cpu    = 1.0
      memory = "2Gi"

      env {
        name        = "NEO4J_AUTH"
        secret_name = "neo4j-auth"
      }

      env {
        name  = "NEO4J_server_default__listen__address"
        value = "0.0.0.0"
      }

      env {
        name  = "NEO4J_server_memory_heap_max__size"
        value = "1G"
      }

      volume_mounts {
        name = "neo4j-data"
        path = "/data"
      }
    }

    container {
      name   = "backend"
      image  = "${azurerm_container_registry.main.login_server}/vast-backend:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NEO4J_URI"
        value = "bolt://localhost:7687"
      }

      env {
        name  = "NEO4J_USER"
        value = "neo4j"
      }

      env {
        name        = "NEO4J_PASSWORD"
        secret_name = "neo4j-password"
      }

      env {
        name  = "DATA_PATH"
        value = "/app/data/MC1_final_00.json"
      }

      # On a cold start Neo4j needs to come up and the MC1 JSON is imported,
      # which can take a few minutes - the probes are relaxed accordingly.
      liveness_probe {
        transport        = "HTTP"
        port             = 8000
        path             = "/api/health"
        initial_delay    = 90
        interval_seconds = 30
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/api/health"
        interval_seconds        = 15
        failure_count_threshold = 20
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8000
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [azurerm_role_assignment.acr_pull]
}

# ---------------------------------------------------------------------------
# web: serves the React production build through nginx and proxies /api/*
# to the backend, so the frontend image does not need to know the backend URL
# at build time.
# ---------------------------------------------------------------------------
resource "azurerm_container_app" "web" {
  name                         = "ca-${local.name_prefix}-web"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.apps.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.apps.id
  }

  template {
    # Scales to zero when there is no traffic, which stops the meter.
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "web"
      image  = "${azurerm_container_registry.main.login_server}/vast-frontend:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "BACKEND_ORIGIN"
        value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [azurerm_role_assignment.acr_pull]
}
