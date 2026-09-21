FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG APP_VERSION=dev
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN printf '%s\n' "$APP_VERSION" > /app/VERSION

FROM node:22-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/VERSION ./VERSION
RUN mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "server.js"]
