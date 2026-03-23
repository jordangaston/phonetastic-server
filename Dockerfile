# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx baml-cli generate
RUN npm run build
RUN APP_KEY=build-placeholder node dist/agent.js download-files
RUN npm prune --omit=dev

FROM base AS production
ARG UID=10001
RUN adduser --disabled-password --gecos "" --home "/app" --shell "/sbin/nologin" --uid "${UID}" appuser
COPY --from=build --chown=appuser:appuser /app/node_modules /app/node_modules
COPY --from=build --chown=appuser:appuser /app/dist /app/dist
COPY --from=build --chown=appuser:appuser /app/package.json /app/package.json
COPY --from=build --chown=appuser:appuser /app/baml_src /app/baml_src
USER appuser

ENV OTEL_SERVICE_NAME="phonetastic-agent"

CMD ["node", "dist/agent.js", "start"]
