FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY web/package.json web/package-lock.json ./
COPY web/vendor/sarvam-conv-ai-sdk-browser-0.0.42.tgz ./vendor/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY web/tsconfig.json ./
COPY web/src/lib ./src/lib
COPY web/scripts/result-worker.ts ./scripts/
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/result-worker.ts"]
