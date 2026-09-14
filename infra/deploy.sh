#!/usr/bin/env bash
# End-to-end deployment. Run it from anywhere:  ./infra/deploy.sh
#
# Flow:
#   1. create the registry first (the images need somewhere to be pushed),
#   2. import the images published by CI into that registry,
#   3. apply the rest of the infrastructure.
#
# The images themselves are built by .github/workflows/images.yml and pushed to
# GitHub Container Registry. `az acr build` is not an option (ACR Tasks is
# disabled on Azure for Students subscriptions), and building locally would
# require Docker plus an amd64 emulation pass on Apple Silicon - so the build
# lives in CI and this script only copies the result into ACR, server side.
# No Docker needed on the machine running this script.
set -euo pipefail

cd "$(dirname "$0")"

: "${TF_VAR_neo4j_password:?set it first: export TF_VAR_neo4j_password='...'}"

IMAGE_TAG="${IMAGE_TAG:-v1}"
export TF_VAR_image_tag="$IMAGE_TAG"

echo "==> 1/4  terraform init"
terraform init -input=false

echo "==> 2/4  registry layer only"
terraform apply -input=false -auto-approve \
  -target=azurerm_resource_group.main \
  -target=azurerm_container_registry.main

ACR_NAME="$(terraform output -raw acr_name)"

# GitHub owner whose packages hold the CI-built images.
GHCR_OWNER="${GHCR_OWNER:-keremilgaz}"
SOURCE="ghcr.io/${GHCR_OWNER}"

# Public packages need no credentials. For private ones, export GHCR_TOKEN
# (a PAT with read:packages) and optionally GHCR_USERNAME.
if [ -n "${GHCR_TOKEN:-}" ]; then
  AUTH=(--username "${GHCR_USERNAME:-$GHCR_OWNER}" --password "$GHCR_TOKEN")
else
  AUTH=()
fi

echo "==> 3/4  importing images from $SOURCE into $ACR_NAME"
for image in vast-backend vast-frontend; do
  az acr import \
    --name "$ACR_NAME" \
    --source "${SOURCE}/${image}:${IMAGE_TAG}" \
    --image "${image}:${IMAGE_TAG}" \
    --force \
    ${AUTH[@]+"${AUTH[@]}"}
  echo "    imported ${image}:${IMAGE_TAG}"
done

echo "==> 4/4  full infrastructure"
terraform apply -input=false

echo
terraform output
