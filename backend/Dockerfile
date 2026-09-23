FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Outils de compilation au cas ou le binaire precompile de better-sqlite3 n'est pas telechargeable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/cals.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
