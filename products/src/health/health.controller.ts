import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Контроллер мониторинга состояния сервиса (Observability).
 * Интегрирован с жизненным циклом Kubernetes (K8s) через механизмы Probes.
 *
 * Контроллер проверки работоспособности (Health Check).
 * Используется Kubernetes (Liveness/Readiness probes) для мониторинга
 * состояния инстанса и его зависимостей.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Проверка готовности (Readiness Probe).
   * Возвращает 200 только если БД и Redis доступны.
   */
  /**
   * Readiness Probe (Проверка готовности).
   * Kubernetes вызывает этот эндпоинт, чтобы решить: можно ли направлять трафик на этот инстанс.
   *
   * @description
   * Возвращает 200 OK только при наличии активных соединений с PostgreSQL и Redis.
   * Если база данных "прогревается" или недоступна, сервис временно исключается из балансировщика,
   * предотвращая ошибки 500 для конечных пользователей.
   */
  @Get('ready')
  async checkReady() {
    try {
      // Проверяем соединение с БД
      await this.prisma.$queryRaw`SELECT 1`;
      // Проверяем доступность Redis
      const redisClient = await this.redis.getRedisClient();
      if (redisClient.status !== 'ready') throw new Error('Redis not ready');

      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (e) {
      // Если база или кэш упали - сигнализируем K8s, чтобы он убрал трафик с этого Пода
      throw new HttpException(
        'Service Unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Проверка жизни (Liveness Probe).
   * Сообщает K8s, что процесс Node.js жив и не завис.
   */
  /**
   * Liveness Probe (Проверка жизнеспособности).
   * Используется для обнаружения "зависших" процессов (Deadlocks, Event Loop block).
   *
   * @description
   * Если этот метод перестает отвечать, Kubernetes принудительно перезапускает контейнер (Restart Policy).
   * Здесь намеренно НЕ проверяются внешние зависимости (БД), чтобы избежать каскадных перезапусков
   * всех подов при временном сбое сети или базы.
   */
  @Get('live')
  checkLive() {
    return { status: 'alive' };
  }
}
/**
 * «Я реализовал Health Check эндпоинты (/health/ready и /health/live). Это критически
 * важно для работы в Kubernetes. Readiness Probe проверяет доступность
 * PostgreSQL и Redis, чтобы балансировщик не направлял трафик на неготовый сервис.
 * А Liveness Probe позволяет оркестратору автоматически перезапустить контейнер,
 * если основной процесс Node.js зависнет (Memory Leak или Event Loop block)
 * Теперь в папке charts/templates/deployment.yaml можно прописать пути к этим эндпоинтам.
 */
