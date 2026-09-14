# Frontend image for Azure.
# The compose frontend/Dockerfile runs the Vite dev server; this image produces
# a production build, serves it with nginx and proxies /api/* to the backend.
#
#   az acr build -r <acr> -f infra/docker/frontend.Dockerfile -t vast-frontend:v1 .

FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# Left empty on purpose: the app calls its own origin and nginx proxies /api.
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM nginx:1.27-alpine

# The nginx image expands ${VARIABLES} in /etc/nginx/templates/*.template with
# envsubst at startup (BACKEND_ORIGIN is injected by Terraform).
COPY infra/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
