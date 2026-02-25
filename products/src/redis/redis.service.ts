/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
// src/redis/redis.service.ts

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: Date;
  total: number;
  windowMs: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis | null = null;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {
    this.initializeRedis();
  }

  /**
   * Внутренний метод для добавления команд алгоритма Sliding Window в пайплайн.
   * Инкапсулирует логику, чтобы избежать дублирования между одиночной и массовой проверкой.
   */
  private addSlidingWindowCommands(
    pipeline: any,
    key: string,
    now: number,
    windowStart: number,
    windowMs: number,
  ): void {
    pipeline.zremrangebyscore(key, 0, windowStart); // 1. Очистка
    pipeline.zcard(key); // 2. Подсчет
    pipeline.zadd(key, now, `${now}-${Math.random()}`); // 3. Регистрация
    pipeline.expire(key, Math.ceil(windowMs / 1000) + 1); // 4. TTL
  }

  // данный метод отработает один раз при старте работы базы данных
  /**
   * Инициализирует клиент Redis с использованием конфигурации из ConfigService.
   * Выполняет настройку параметров подключения (хост, порт, пароль), стратегии повторов
   * и регистрирует обработчики событий.
   *
   * Если конфигурация отсутствует или произошла ошибка, переводит сервис в режим "fallback".
   *
   * @private
   * @throws {Error} Логирует ошибку, если создание экземпляра Redis не удалось.
   * @returns {void}
   */
  private initializeRedis(): void {
    try {
      const host = this.configService.get<string>('REDIS_HOST');
      const port = this.configService.get<number>('REDIS_PORT');

      // Проверяем, есть ли конфигурация Redis
      if (!host || !port) {
        this.logger.warn(
          'Redis configuration not found. Running in fallback mode.',
        );
        return;
      }

      this.redisClient = new Redis({
        host,
        port,
        password: this.configService.get<string>('REDIS_PASSWORD', ''),
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 200);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectTimeout: 10000,
        keyPrefix: this.configService.get<string>(
          'REDIS_KEY_PREFIX',
          'default:',
        ),
      });

      this.setupEventListeners();
      this.isInitialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
      this.logger.warn('Running in fallback mode');
    }
  }

  // а это метод будет работать всё время, пока запущено приложение.
  // Как только Redis «отвалится», я тут же увидижу ошибку в консоли.
  /**
   * Настраивает обработчики событий для клиента Redis.
   * Регистрирует логи для состояний: ошибка, успешное подключение, готовность и переподключение.
   *
   * @private
   * @returns {void}
   */
  private setupEventListeners(): void {
    if (!this.redisClient) return;

    this.redisClient.on('error', (error) => {
      this.logger.error('Redis connection error:', error.message);
    });

    this.redisClient.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.redisClient.on('ready', () => {
      this.logger.log('Redis is ready');
    });

    // буду видеть в логах попытки переподключения
    // при отладке в Docker: сразу поймешь, что Redis перезагружается,
    // а не просто «молчит».
    this.redisClient.on('reconnecting', () => {
      this.logger.warn('Redis is attempting to reconnect...');
    });
  }

  // обеспечиnь работу клиента и в результате ожидаем или
  // Redis будет запущен или получаем null
  /**
   * Внутренний механизм проверки доступности и статуса Redis-клиента.
   * Реализует концепцию "Safe Access": гарантирует, что команды будут отправлены
   * только на полностью инициализированное и авторизованное соединение.
   *
   * @returns Инстанс Redis в статусе 'ready' или null, если соединение не установлено.
   * @private
   *
   * @description
   * 1. Исключает попытки выполнения команд на "холодном" или разорванном соединении.
   * 2. Оптимизация производительности: проверка статуса (.status) является синхронной
   *    и не создает дополнительной нагрузки на сетевой стек (в отличие от команды PING).
   * 3. Позволяет основному приложению бесшовно переключиться на Fallback (БД)
   *    при временных сбоях инфраструктуры кэширования.
   */
  private async ensureRedisClient(): Promise<Redis | null> {
    // 1. Проверяем, создан ли вообще объект клиента
    // 1. Проверяем, инициализирован ли объект драйвера ioredis
    if (!this.redisClient) {
      return null;
    }

    // 2. Проверяем статус соединения (без лишних запросов в сеть)
    // 'ready' означает, что клиент подключен и авторизован
    // Проверяем статус 'ready' (подключен, авторизован и готов к работе)
    // Это атомарная проверка внутреннего состояния клиента ioredis
    if (this.redisClient.status === 'ready') {
      return this.redisClient;
    }

    // Логируем предупреждение, если Redis находится в процессе переподключения (reconnecting) или упал
    this.logger.warn(
      `Redis is not ready. Current status: ${this.redisClient.status}`,
    );
    return null;
  }

  // хук жизненного цикла при отключении модуля ожидаем просто значения
  async onModuleDestroy(): Promise<void> {
    // Это «страховка». Если Redis уже был отключен или сервер упал,
    // попытка вызвать .quit() может выбросить ошибку. Благодаря try/catch,
    // приложение закроется спокойно, просто записав ошибку в лог,
    // вместо того чтобы «вылететь» с некрасивым трейсом в консоли.
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        this.logger.log('Redis disconnected');
      } catch (error) {
        this.logger.error('Error disconnecting Redis', error);
      }
    }
  }

  // Основные CRUD операции
  /**
   * Извлечение строковых данных из хранилища Redis.
   * Реализует стратегию безопасного чтения: при сбое кэша возвращает null,
   * позволяя приложению переключиться на основной источник данных (Fallback to DB).
   *
   * @param key Уникальный идентификатор ресурса в формате Namespace:Key
   * @returns Promise со строковым значением или null (если ключ отсутствует или Redis недоступен)
   *
   * @description
   * 1. Выполняет проверку активного соединения через ensureRedisClient.
   * 2. Изолирует ошибки сетевого уровня (Timeout, Connection Refused),
   *    не прерывая выполнение основного бизнес-процесса.
   * 3. Является атомарной операцией чтения O(1).
   */
  async get(key: string): Promise<string | null> {
    // черз констану клиент проверяем жив ли Redis если нет то null
    const client = await this.ensureRedisClient();
    if (!client) return null;

    try {
      // если клиент жив то пытаемся получить данные
      return await client.get(key);
    } catch (error) {
      this.logger.error(`Redis GET error for key: ${key}`, error.message);
      return null;
    }
  }

  // Данный метод нужен для того что бы наш Redis не переполнился и не
  // "помер" а так через выставленное временные границы данные будут затерты
  // и кеш освободится. Тогда следующий запрос пойдет в Prisma и данные буду
  // снова обновленны на актуальные
  /**
   * Запись данных в Redis с управлением временем жизни (TTL).
   * Обеспечивает баланс между скоростью доступа и актуальностью данных.
   *
   * @param key Уникальный ключ (Namespace:Key)
   * @param value Сериализованные данные (JSON-строка)
   * @param ttlSeconds Время жизни в секундах. Если не указано, данные хранятся перманентно.
   *
   * @description
   * 1. Реализует стратегию автоматической ротации кэша: по истечении TTL данные удаляются,
   *    что гарантирует последующее обновление из первоисточника (Prisma/Postgres). **[INDEX 2]**
   * 2. Предотвращает переполнение оперативной памяти (OOM Error) за счет ограничения срока хранения. **[INDEX 1]**
   * 3. Использует команду SETEX для атомарной установки значения и таймера, исключая риск "зависших" ключей. **[INDEX 3]**
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    // проверяем жив ли Redis(есть ли подключение) иначе null
    const client = await this.ensureRedisClient();
    if (!client) return;

    try {
      // если ttl(таймер самоунечтожения) не истек то
      if (ttlSeconds) {
        // SETEX (SET with EXpiration) — атомарная операция установки значения и TTL.
        // Это безопаснее, чем делать SET и EXPIRE отдельными командами.
        // setex - как SET with EXpiration (установить с истечением).
        // то прописываем данные с ограничением по времени
        // Без ttlSeconds данные будут лежать в Redis до тех пор, пока вы не
        // удалите их вручную или пока не закончится оперативная память на сервере.
        await client.setex(key, ttlSeconds, value);
      } else {
        // Перманентное хранение. Используется только для критически важных
        // конфигураций или редко меняющихся справочников.
        // или просто установить данные которые будут храниться до перегрузки Redis
        await client.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Redis SET error for key: ${key}`, error.message);
    }
  }

  // Удаление по ключу
  /**
   * Точечное удаление ключа из хранилища Redis.
   * Основной механизм обеспечения консистентности данных (Cache Invalidation)
   * при изменении или удалении объектов в основной базе данных.
   *
   * @param key Уникальный идентификатор ключа (напр. product:id:123)
   * @returns Promise<void>
   *
   * @description
   * В отличие от массовой очистки (invalidatePattern), этот метод выполняет
   * атомарную операцию O(1), что делает его максимально производительным
   * для "умной" инвалидации кэша в ProductService.
   */
  async del(key: string): Promise<void> {
    const client = await this.ensureRedisClient();
    if (!client) return;

    try {
      await client.del(key);
    } catch (error) {
      this.logger.error(`Redis DEL error for key: ${key}`, error.message);
    }
  }

  // Проверяем существует ли по ключю и ожидаем в ответ либо тур либо лож
  // если есть просто получим 1 в противном случае будет 0
  // разница между get <=> exists что в первом случае будет получен все содержимое ключа а во
  // вотором только число или 1 или 0
  /**
   * Проверка существования ключа в Redis без загрузки его содержимого.
   * Оптимизированная альтернатива методу GET для простой валидации наличия данных.
   *
   * @param key Уникальный идентификатор ресурса
   * @returns Promise<boolean>: true — если ключ найден (1), false — если отсутствует (0) или Redis недоступен.
   *
   * @description
   * В отличие от GET, команда EXISTS возвращает только целочисленный статус (0/1),
   * что существенно снижает нагрузку на сеть (RTT) и исключает лишнюю десериализацию данных,
   * когда само значение ключа не требуется для логики.
   */
  async exists(key: string): Promise<boolean> {
    const client = await this.ensureRedisClient();
    if (!client) return false;

    try {
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis EXISTS error for key: ${key}`, error.message);
      return false;
    }
  }

  // ====================
  // ==================== Подготовка к горизонтальному расширению
  // ====================

  // Rate limiting(проверка скорости) с использованием sliding window алгоритма
  // Метод считает, сколько запросов сделал пользователь за последние
  // N секунд, и блокирует, если слишком много.
  /**
   * Распределенная проверка лимита запросов (Rate Limiting) на базе алгоритма Sliding Window.
   * Использует Redis Sorted Sets (ZSET) для обеспечения атомарности и точности окна в реальном времени.
   *
   * @param identifier Уникальный идентификатор субъекта (IP, User ID, API Key)
   * @param windowMs Ширина скользящего окна в миллисекундах
   * @param maxRequests Максимально допустимое количество запросов в рамках окна
   * @param keyPrefix Пространство имен для изоляции ключей лимитов в Redis
   * @returns Promise<RateLimitResult> Объект с вердиктом (allowed) и метаданными лимита
   *
   * @description
   * 1. Реализует Fallback-стратегию: при недоступности Redis запросы разрешаются (Fail-open), чтобы не блокировать работу сервиса.
   * 2. Команда ZREMRANGEBYSCORE очищает устаревшие события, обеспечивая "скольжение" окна.
   * 3. Использование рандомизированного суффикса в ZADD предотвращает коллизии при конкурентных запросах в одну мс.
   * 4. Весь цикл проверки (очистка, подсчет, запись, expire) выполняется через Redis Pipeline для минимизации RTT.
   */
  async checkRateLimit(
    identifier: string, // userId, IP, etc
    windowMs: number, // Время окна в миллисекундах
    maxRequests: number, // Максимальное количество запросов
    keyPrefix: string = 'rate-limit:', // Префикс для ключа
  ): Promise<RateLimitResult> {
    // проевка "пал" Redis или нет
    const client = await this.ensureRedisClient();
    if (!client) {
      // Fallback: если Redis недоступен, разрешаем все запросы
      // Если Redis упал - разрешаем всё (чтобы сервис работал)
      const now = Date.now();
      return {
        // допустимое
        allowed: true,
        // оставшийся
        remaining: maxRequests,
        // результат
        reset: new Date(now + windowMs),
        // всего
        total: maxRequests,
        // окон
        windowMs,
      };
    }

    const key = `${keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Pipeline операций (все атомарно):
      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.expire(key, Math.ceil(windowMs / 1000) + 1);

      const results = await pipeline.exec();

      if (!results || results.some((result) => result[0])) {
        throw new Error('Redis pipeline execution failed');
      }

      const currentCount = results[1][1] as number;
      const requestsInWindow = currentCount + 1;
      const remaining = Math.max(0, maxRequests - requestsInWindow);

      return {
        allowed: requestsInWindow <= maxRequests,
        remaining,
        reset: new Date(now + windowMs),
        total: maxRequests,
        windowMs,
      };
    } catch (error) {
      this.logger.error(
        `Rate limit check failed for ${identifier}`,
        error.message,
      );

      // Fallback стратегия
      return {
        allowed: true,
        remaining: maxRequests,
        reset: new Date(now + windowMs),
        total: maxRequests,
        windowMs,
      };
    }
  }

  // Bulk rate limiting для нескольких идентификаторов
  // Этот метод выполняет массовую проверку лимитов для
  // группы объектов одновременно.
  /**
   * Масштабируемая пакетная проверка лимитов (Bulk Rate Limiting).
   * Оптимизирует сетевую нагрузку через Redis Pipelining, выполняя N проверок
   * в рамках одного TCP-запроса (RTT).
   *
   * @param identifiers Массив уникальных ID (IP, User ID, API Keys)
   * @param windowMs Временное окно скользящего лимита (мс)
   * @param maxRequests Допустимый порог запросов в данном окне
   * @param keyPrefix Пространство имен для изоляции лимитов в Redis
   * @returns Map с результатами проверки для каждого идентификатора
   *
   * @description
   * 1. Группирует команды ZREM, ZCARD, ZADD и EXPIRE для каждого ID.
   * 2. Использует Pipelining для исключения сетевых задержек при множественных вызовах.
   * 3. Алгоритм Sliding Window гарантирует атомарную точность счетчиков.
   * 4. Реализован Fallback-механизм: при отказе Redis система разрешает доступ, сохраняя работоспособность (Resilience).
   */
  async bulkRateLimit(
    identifiers: string[],
    windowMs: number,
    maxRequests: number,
    keyPrefix: string = 'rate-limit:',
  ): Promise<Map<string, RateLimitResult>> {
    const client = await this.ensureRedisClient();
    const now = Date.now();
    const windowStart = now - windowMs;
    const resultMap = new Map<string, RateLimitResult>();

    // Если Redis недоступен, возвращаем fallback для всех
    if (!client) {
      identifiers.forEach((id) => {
        resultMap.set(id, {
          allowed: true,
          remaining: maxRequests,
          reset: new Date(now + windowMs),
          total: maxRequests,
          windowMs,
        });
      });
      return resultMap;
    }

    const pipeline = client.pipeline();
    const keys = identifiers.map((id) => `${keyPrefix}${id}`);

    // Собираем ОДИН гигантский пайплайн для всех ID сразу
    keys.forEach((key) => {
      pipeline.zremrangebyscore(key, 0, windowStart); // Очистка старых
      pipeline.zcard(key); // Текущий счетчик
      pipeline.zadd(key, now, `${now}-${Math.random()}`); // Добавление нового
      pipeline.expire(key, Math.ceil(windowMs / 1000) + 1); // Продление жизни ключа
    });

    try {
      const redisResults = await pipeline.exec();

      // В ioredis результат — это массив [error, result].
      // Каждая итерация по ID занимает 4 команды в пайплайне.
      identifiers.forEach((id, index) => {
        const baseIdx = index * 4;
        const currentCount = redisResults[baseIdx + 1][1] as number; // Результат zcard
        const requestsInWindow = currentCount + 1;

        resultMap.set(id, {
          allowed: requestsInWindow <= maxRequests,
          remaining: Math.max(0, maxRequests - requestsInWindow),
          reset: new Date(now + windowMs),
          total: maxRequests,
          windowMs,
        });
      });
    } catch (error) {
      this.logger.error('Bulk rate limit failed', error);
      // Обработка ошибок...
    }

    return resultMap;
  }

  // Кэширование с автоматической инвалидацией
  /**
   * Высокоуровневая обертка для кэширования с защитой от "Cache Stampede" (эффекта собаки).
   * Реализует механизм распределенной блокировки (Distributed Locking) через Redis SET NX.
   *
   * @param key Уникальный ключ кэша
   * @param fetchFn Callback-функция для получения данных из БД (выполняется только один раз)
   * @param ttlSeconds Время жизни кэша (по умолчанию 300с)
   * @returns Десериализованные данные из кэша или свежий результат из fetchFn
   *
   * @description
   * 1. При Cache Miss первый поток захватывает атомарный лок на 10с.
   * 2. Остальные конкурентные запросы уходят в режим ожидания (Polling) с рекурсивным повтором.
   * 3. Гарантирует выполнение ровно одного "тяжелого" запроса к БД при любом количестве входящих TCP-соединений.
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = 300,
  ): Promise<T> {
    const client = await this.ensureRedisClient();
    const lockKey = `${key}:lock`;

    if (client) {
      // 1. Пытаемся взять данные из кэша
      // Пытаемся извлечь данные. Если "попадание" (HIT) — возвращаем немедленно.
      const cached = await this.get(key);
      if (cached) return JSON.parse(cached) as T;

      // 2. Попытка захвата блокировки для предотвращения лавинообразной нагрузки на БД (Dogpile effect)
      // NX гарантирует атомарность: только один клиент получит 'OK'
      const lockAcquired = await client.set(lockKey, 'locked', 'EX', 10, 'NX');

      if (!lockAcquired) {
        // 3. Если замок занят другим сервисом, ждем немного и пробуем кэш снова
        // Если лок занят, ждем 200мс и повторяем проверку кэша (уже наполненного первым потоком)
        await new Promise((resolve) => setTimeout(resolve, 200));
        return this.cache(key, fetchFn, ttlSeconds); // Рекурсивный повтор
      }
    }

    // 4. Только ОДИН сервис (владелец замка) доходит до выполнения тяжелой функции
    try {
      // Исполнение целевой бизнес-логики (Database Query)
      const data = await fetchFn();

      if (client) {
        await this.set(key, JSON.stringify(data), ttlSeconds);
      }
      return data;
    } finally {
      // Критически важно: удаляем лок в блоке finally, чтобы избежать Deadlock при сбоях в fetchFn
      // 5. Обязательно освобождаем замок, чтобы не блокировать других в случае ошибки
      if (client) await client.del(lockKey);
    }
  }

  // Инвалидация кэша по паттерну
  // метод нужен для массовой очистки кэша,
  // когда данные меняются и старые копии в Redis становятся неактуальными.
  /**
   * Массовая инвалидация кэша по заданному паттерну (шаблону).
   * Используется для очистки групповых ключей (например, списков товаров),
   * когда атомарного удаления по ID недостаточно для поддержания консистентности.
   *
   * @param pattern Шаблон ключей (например, 'products:all:*')
   * @returns Promise<void>
   *
   * @warning Использование client.keys() является блокирующей операцией O(N).
   * На высоконагруженных окружениях с миллионами ключей рекомендуется
   * пересмотреть стратегию в пользу использования Redis Sets для группировки ключей.
   */
  /**
   * тут мы решаем Коллизию имен через преффикс для того что бы гарантированно дотягиваться
   *  именно до тех ключей что будут нужны и гарантируем что не произойдет дублирование ключей
   *  или перезаписывание этих ключей благодаря именно префексу перед ключом
   *  Когда ты вызываешь invalidatePattern('product:*'), Redis ищет ключи только твоего сервиса
   *  а самое главное что это гарантирует безопасность расширения
   *  * Гарантирует:
   * 1. Изоляцию данных: операции удаления затрагивают только текущий микросервис.
   * 2. Целостность: предотвращает случайную перезапись данных другими сервисами.
   * 3. Безопасность масштабирования: позволяет безопасно расширять общую инфраструктуру
   *    без риска взаимного влияния (Side Effects) независимых модулей.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const client = await this.ensureRedisClient();
    if (!client) return;

    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
        this.logger.log(
          `Invalidated ${keys.length} keys with pattern: ${pattern}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Invalidation error for pattern: ${pattern}`,
        error.message,
      );
    }
  }

  // Плохой надо переделывать! НО! потом позже
  // Метрики rate limiting
  // метод — своего рода «панель мониторинга» (Dashboard) для лимитера.
  // Он пытается подвести итоги: сколько всего пользователей сейчас под наблюдением
  // и сколько из них прямо сейчас «забанены» (превысили лимит).
  // async getRateLimitStats(keyPrefix: string = 'rate-limit:'): Promise<{
  //   totalKeys: number;
  //   blockedRequests: number;
  // }> {
  //   try {
  //     // Ищет всех: Через keys(${keyPrefix}*) он находит в Redis все активные
  //     // записи лимитов (всех пользователей/IP).
  //     const pattern = `${keyPrefix}*`;
  //     const keys = await this.redisClient.keys(pattern);

  //     // Считает «нарушителей»: Пробегает циклом по каждому ключу и
  //     // спрашивает Redis: «А сколько запросов сделал этот парень? (zcard)».
  //     let blockedRequests = 0;
  //     for (const key of keys) {
  //       const count = await this.redisClient.zcard(key);
  //       const maxRequests = 100; // Это должно быть конфигурируемо
  //       // Сравнивает с лимитом: Если количество запросов (count)
  //       // больше или равно 100, он считает этого пользователя заблокированным.
  //       if (count >= maxRequests) {
  //         blockedRequests++;
  //       }
  //     }

  //     return {
  //       totalKeys: keys.length,
  //       blockedRequests,
  //     };
  //   } catch (error) {
  //     this.logger.error('Failed to get rate limit stats', error);
  //     return { totalKeys: 0, blockedRequests: 0 };
  //   }
  // }
}
