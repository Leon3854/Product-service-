import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { RateLimitGuard } from '../redis/rate-limit.guard';
import { APP_GUARD } from '@nestjs/core';
import { ProductResolver } from 'src/resolvers/product.resolver';

@Module({
  controllers: [ProductController],
  providers: [
    ProductService,
    ProductResolver,
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
