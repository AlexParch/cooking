# Официальный образ Node. Зеркало AWS работает и там, где Docker Hub недоступен/ограничен.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24-slim

# Сборка
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY server ./server
COPY public ./public
RUN npm run build:server

# Запуск: только Node + собранный файл + статика + миграции
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY --from=build /app/dist ./dist
COPY public ./public
COPY migrations ./migrations
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.mjs"]
