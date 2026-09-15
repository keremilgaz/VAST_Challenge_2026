variable "subscription_id" {
  description = "Azure subscription ID (az account show --query id -o tsv)."
  type        = string
}

variable "project" {
  description = "Short project code. Forms the body of every resource name."
  type        = string
  default     = "vast"

  validation {
    condition     = can(regex("^[a-z0-9]{2,10}$", var.project))
    error_message = "project must be 2-10 lowercase alphanumeric characters."
  }
}

variable "environment" {
  description = "Environment name (dev / stage / prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "stage", "prod"], var.environment)
    error_message = "environment must be one of dev, stage, prod."
  }
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}

variable "owner" {
  description = "Resource owner, applied as a tag. Required for cost/ownership hygiene."
  type        = string
  default     = "kerem.ilgaz"
}

variable "cost_center" {
  description = "Cost center tag value."
  type        = string
  default     = "personal-learning"
}

variable "extra_tags" {
  description = "Additional tags merged into the common tag set."
  type        = map(string)
  default     = {}
}

variable "image_tag" {
  description = "Tag of the backend/frontend images pushed to ACR."
  type        = string
  default     = "v1"
}

variable "neo4j_password" {
  description = "Neo4j password. Never stored in terraform.tfvars - pass it via TF_VAR_neo4j_password."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.neo4j_password) >= 12
    error_message = "Neo4j requires at least 8 characters; this configuration enforces 12."
  }
}

variable "log_retention_days" {
  description = "Log Analytics retention in days."
  type        = number
  default     = 30
}

variable "backend_min_replicas" {
  description = "Minimum replicas for the backend + Neo4j app. Setting it to 0 also stops Neo4j, which triggers a re-import on the next cold start."
  type        = number
  default     = 1
}
