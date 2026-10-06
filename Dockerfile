# Obraz budowany na NAS (QNAP), więc zawsze pasuje do jego procesora.
# Serwer to TypeScript uruchamiany bezpośrednio przez Node 24 — buduje się tylko frontend.

FROM node:24-alpine AS build
WORKDIR /src
# tsconfig.base.json: web/tsconfig.json dziedziczy z niego, a Vite czyta tsconfig przy budowaniu.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY web web
RUN npm run build -w web

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund -w server && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY --from=build /src/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/src/index.ts"]
