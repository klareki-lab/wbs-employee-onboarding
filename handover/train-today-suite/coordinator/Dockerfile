FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.mjs mcp.mjs catalog.mjs storage.mjs domain.mjs management.mjs task-actions.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node workflows ./workflows
COPY --chown=node:node config.json ./config.json
USER node
CMD ["node", "server.mjs"]
