import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { RateLimitGuard } from '../redis/rate-limit.guard';
import { APP_GUARD } from '@nestjs/core';
import { ProductResolver } from 'src/resolvers/product.resolver';
import { ProductGateway } from './gateways/product.gateway';
/**
 * Функциональное ядро системы управления товарами.
 * Инкапсулирует в себе полный стек технологий для работы в Highload-среде.
 *
 * Включает:
 * 1. Interface Layer: REST (Controller) и GraphQL (Resolver).
 * 2. Real-time Layer: WebSocket Gateway для мгновенных уведомлений.
 * 3. Infrastructure Layer: Kafka (события), Redis (кэш/лимиты) и Prisma (БД).
 * 4. Security Layer: Глобальный RateLimitGuard для защиты от DDoS и парсинга.
 */
@Module({
  controllers: [ProductController],
  providers: [
    ProductService,
    ProductResolver,
    ProductGateway,
    PrismaService,
    RedisService,
    KafkaProducerService,
    // РЕГИСТРИРУЕМ ГАРД ГЛОБАЛЬНО ДЛЯ ВСЕГО МОДУЛЯ
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [ProductService],
})
export class ProductModule {}
