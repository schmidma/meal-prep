FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The root prepare hook needs the source tree, which is copied next.
RUN npm ci --ignore-scripts
COPY svelte.config.js vite.config.ts tsconfig.json ./
COPY src ./src
COPY static ./static
RUN npm run prepare && npm run build

FROM docker.io/library/node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM docker.io/library/node:24-bookworm-slim AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Meal Prep" \
      org.opencontainers.image.description="A self-hosted household meal planner" \
      org.opencontainers.image.source="https://github.com/schmidma/meal-prep" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MEAL_PREP_DB_PATH=/data/meal-prep.sqlite
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json LICENSE ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "build"]
