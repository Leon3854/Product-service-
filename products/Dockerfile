# --- STAGE 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем конфиги для установки зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем всё (включая devDependencies для компиляции)
RUN npm ci

# Копируем остальной код и генерируем Prisma Client
COPY . .
RUN npx prisma generate
RUN npm run build

# --- STAGE 2: Runtime ---
FROM node:20-alpine AS runner

WORKDIR /app

# Копируем только необходимые файлы из первого этапа
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Указываем переменную окружения для Production
ENV NODE_ENV=production

# Открываем порты (REST и gRPC если будет)
EXPOSE 3000

# Команда запуска
CMD ["node", "dist/main"]