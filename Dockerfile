# syntax=docker/dockerfile:1

# ---- 依赖层 ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建 Web 静态产物 ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Web 服务：仅托管静态文件，无业务后端、不访问在线服务 ----
FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
# 零依赖 Node 静态服务器 + 纯静态产物，运行镜像无需 npm 依赖
COPY --from=build /app/dist ./dist
COPY docker/server.mjs ./docker/server.mjs
EXPOSE 4173
CMD ["node", "docker/server.mjs"]

# ---- verify：一次性验收服务（类型检查 + Vitest + Playwright）----
FROM deps AS verify
WORKDIR /app
# Playwright 需要 Chromium 与系统库
RUN npx playwright install --with-deps chromium
COPY . .
ENV PLAYWRIGHT_BASE_URL=http://web:4173
# 容器退出码即验收结果：全部通过为 0；存在 BASE_URL 时不启动本地 webServer
CMD ["sh", "-c", "npm run typecheck && npm run test && npx playwright test"]
