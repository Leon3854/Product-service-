// product-cache.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Product } from './types/product.type';

@Injectable()
export class ProductCacheService {
  private readonly logger = new Logger(ProductCacheService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Получение продуктов с подсчетом попаданий в кэш
   */
  async getProductsWithMetrics(
    cacheKey: string,
    fetchFn: () => Promise<Product[]>,
    ttl: number,
  ): Promise<{ products: Product[]; cacheHit: boolean }> {
    const start = Date.now();

    // Пробуем получить из кэша
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      const duration = Date.now() - start;
      this.logger.debug(`⚡ Cache HIT for ${cacheKey} (${duration}ms)`);

      // Логируем метрики
      await this.redisService.incr(`metrics:cache:hits:${cacheKey}`);

      return {
        products: JSON.parse(cached),
        cacheHit: true,
      };
    }

    // Cache miss - грузим из БД
    const products = await fetchFn();

    const duration = Date.now() - start;
    this.logger.debug(`🐢 Cache MISS for ${cacheKey} (${duration}ms)`);

    // Логируем метрики
    await this.redisService.incr(`metrics:cache:misses:${cacheKey}`);

    // Сохраняем в кэш
    if (products.length > 0) {
      await this.redisService.set(cacheKey, JSON.stringify(products), ttl);
    }

    return {
      products,
      cacheHit: false,
    };
  }

  /**
   * Получение статистики кэша
   */
  async getCacheStats(): Promise<{
    hits: Record<string, number>;
    misses: Record<string, number>;
    hitRate: number;
  }> {
    const hits: Record<string, number> = {};
    const misses: Record<string, number> = {};

    // Получаем все ключи метрик
    const hitKeys = await this.redisService['ensureRedisClient']().then(
      (client) => client?.keys('metrics:cache:hits:*') || [],
    );

    const missKeys = await this.redisService['ensureRedisClient']().then(
      (client) => client?.keys('metrics:cache:misses:*') || [],
    );

    // Собираем статистику
    let totalHits = 0;
    let totalMisses = 0;

    for (const key of hitKeys) {
      const value = await this.redisService.get(key);
      const count = parseInt(value || '0', 10);
      hits[key.replace('metrics:cache:hits:', '')] = count;
      totalHits += count;
    }

    for (const key of missKeys) {
      const value = await this.redisService.get(key);
      const count = parseInt(value || '0', 10);
      misses[key.replace('metrics:cache:misses:', '')] = count;
      totalMisses += count;
    }

    const totalRequests = totalHits + totalMisses;
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

    return {
      hits,
      misses,
      hitRate,
    };
  }

  /** 
	 * Этот сервис — отличный инструмент для аналитики, но в текущем виде и для этого сервиса он, 
	 * скорее всего, лишний. Почему он не нужен на этапе запуска микросервиса.
	*  1. Что он дает (Плюсы)
Прозрачность: Видишь Hit Rate (процент попаданий в кэш). Если он, например, 10% — значит, 
кэш настроен плохо и почти не помогает базе данных. Если 90% — ты молодец, база «отдыхает».
Поиск проблем: Можно увидеть, какие именно ключи постоянно «промахиваются» (Cache Miss) 
и почему.
KPI: Позволяет гордо сказать: «Мой микросервис обрабатывает 95% запросов через Redis 
за 2мс».
2. Почему он сейчас НЕ нужен (Минусы)
А. Проблема «Лишних запросов» к Redis
Смотрим на код: чтобы просто записать метрику «промаха» или «попадания», сервис делает 
дополнительный запрос this.redisService.incr(...) при каждом обращении пользователя.
Это создает лишнюю нагрузку на Redis. Попытка ускорить систему кэшем, но при этом 
замедляем её постоянной записью статистики.
Б. Опасный метод getCacheStats
Метод использует client.keys(). Как мы уже обсуждали, эта команда блокирует Redis, если 
ключей много. В продакшене это может «уронить» производительность всего сервиса.
В. Усложнение архитектуры
Уже есть отличный ProductService, который умеет кэшировать. Добавление 
ProductCacheService создает «слоеный пирог» из сервисов, где один вызывает другой, 
который вызывает третий. Это затрудняет отладку.
3. Совет: Что с этим делать?
Для микросервиса на стадии разработки и запуска этот сервис не нужен. Можешь его смело 
удалить или оставить «в столе» на будущее.
Как сделать правильно по-микросервисному:
Если действительно понадобятся метрики (Hit/Miss), в индустрии это делают не через Redis, 
а через Prometheus и Grafana:
Можно просто установить библиотеку prom-client.
В коде кэша пишешь одну строку: cacheHitsCounter.inc().
Prometheus сам собирает эти данные раз в минуту, не нагружая основную базу и Redis.

* я думаю что его оставлю но не буду подключать а в дольнешем конда понадобиться тогда 
его можно будет модернизировать и подключить но только глубоко в дальнешем

* В разработке это называется YAGNI (You Ain't Gonna Need It) — не подключай то, что не 
нужно прямо сейчас, но сохрани как черновик.

*/
}
