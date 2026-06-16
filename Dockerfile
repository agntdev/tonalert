FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
ENV BOT_TOKEN=
ENV OWNER_ID=

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD kill -0 1 || exit 1

USER app
CMD ["node", "dist/index.js"]