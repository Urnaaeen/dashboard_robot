FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node auth.js database.js server.js ./
COPY --chown=node:node database ./database
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

ENV PORT=5173
USER node

EXPOSE 5173

CMD ["node", "server.js"]
