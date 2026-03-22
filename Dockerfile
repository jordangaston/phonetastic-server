# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx baml-cli generate
RUN npm run build
RUN npm prune --omit=dev

FROM base AS production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/drizzle /app/drizzle
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/baml_src /app/baml_src
COPY --from=build /app/src/config/voices /app/src/config/voices

EXPOSE 8080
CMD ["node", "--import", "./dist/instrumentation.js", "dist/server.js"]
