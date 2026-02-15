// src/redis/redis.service.ts

export interface RateLimitResukt {
  allowed: boolean;
  remaining: number;
  reset: Data;
}
