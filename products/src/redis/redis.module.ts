// src/redis/redis.module.ts

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { RateLimitGuard } from './rate-limit.guard';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService, RateLimitGuard],
  exports: [RedisService, RateLimitGuard],
})
export class RedisModule {}
