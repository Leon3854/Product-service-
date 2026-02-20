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

# КРИТИЧНО: Добавляем netcat для работы команды nc
RUN apk add --no-cache netcat-openbsd

# Копируем только необходимое
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

# Команда запуска
# Скрипт запуска: ждем порт 5432 на хосте products-db, затем пушим миграции и стартуем
CMD ["sh", "-c", "until nc -z products-db 5432; do echo 'Waiting for DB...'; sleep 2; done; npx prisma db push && node dist/main"]