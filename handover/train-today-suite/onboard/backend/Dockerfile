FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY backend/package.json ./
COPY database /app/database
USER node
EXPOSE 3001
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
