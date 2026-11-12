# ============================================================================
# STAGE 1: Validação, Testes e Preparação (Multi-Stage Build)
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json ./
COPY src/ ./src/
COPY test/ ./test/

# Validação de sintaxe e testes unitários durante o build da imagem
RUN npm run lint && npm test

# ============================================================================
# STAGE 2: Imagem Final de Produção (Enxuta, Imutável e Não-Root)
# ============================================================================
FROM node:22-alpine AS production

ARG APP_VERSION=1.2.1
LABEL org.opencontainers.image.title="api-gateway" \
      org.opencontainers.image.description="API Gateway HTTP - Loja Veloz" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.vendor="Loja Veloz E-Commerce"

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    GATEWAY_PORT=8080

WORKDIR /app

# Usuário sem privilégios (UID/GID 10001) e remoção de npm, npx, corepack e yarn:
# a imagem final só precisa do runtime do Node, o que reduz a superfície de ataque.
RUN addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup && \
    rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

COPY --from=builder /build/package.json ./
COPY --from=builder /build/src ./src

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]
