# syntax=docker/dockerfile:1.7
# One build, two runtime targets:
#   node-app : api, gateway, worker, demo-upstream and migrations (command chosen per service)
#   web      : static dashboard served by nginx, proxying /api to the API
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/gateway/package.json apps/gateway/
COPY apps/demo-upstream/package.json apps/demo-upstream/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build

FROM deps AS prod-deps
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine AS node-app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/gateway/package.json apps/gateway/
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
COPY --from=build /app/apps/demo-upstream/package.json apps/demo-upstream/
COPY --from=build /app/apps/demo-upstream/dist apps/demo-upstream/dist
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
