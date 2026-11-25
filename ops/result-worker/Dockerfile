FROM node:22-bookworm-slim
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY web/tsconfig.json ./
COPY web/src/lib ./src/lib
COPY web/scripts/result-worker.ts ./scripts/
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/result-worker.ts"]
