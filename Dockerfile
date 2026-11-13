FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

# Create persistent volume mount point owned by the non-root node user (UID 1000)
RUN mkdir -p /data && chown -R node:node /data /app

COPY --chown=node:node package.json server.js version.yml ./
COPY --chown=node:node public ./public

VOLUME ["/data"]

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
