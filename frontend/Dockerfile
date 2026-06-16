FROM node:20-alpine

WORKDIR /app

# package.json + package-lock.json を先にCOPYしてレイヤーキャッシュを効かせる
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
