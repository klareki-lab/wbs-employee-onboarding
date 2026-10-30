FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY tests ./tests
COPY CRM-Hub.html ./CRM-Hub.html
USER node
EXPOSE 3080
CMD ["node", "src/server.mjs"]
