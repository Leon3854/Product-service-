/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { Product } from './types/product.graphql-types';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductService {
  /**
   * Инициализация логгера с контекстом текущего сервиса.
   * Позволяет фильтровать события в распределенной системе мониторинга
   * и упрощает отладку цепочек событий Kafka/Redis.
   */
  /**
   * Стандартный Logger из NestJS поддерживает уровни (debug, warn, error),
   * позволяет добавлять временные метки и, самое главное, привязывает
   * сообщения к конкретному классу, что критично для микросервисов в Docker
   * он лучше console.log
   */
  private readonly logger = new Logger(ProductService.name);

  // Константы для кэширования
  /**
   * Конфигурация времени жизни (TTL) для различных типов данных в Redis.
   * Настройки оптимизированы для обеспечения высокой доступности (High Availability)
   * и минимизации нагрузки на PostgreSQL при сохранении актуальности витрины.
   */
  private readonly CACHE_TTL = {
    // Карточка товара: данные меняются редко, допустим кэш на 5 минут
    PRODUCT: 300, // 5 минут для отдельного продукта
    // Общие списки: высокая частота обновлений, инвалидация каждые 60 секунд
    // для поддержания актуальности сортировки и фильтров
    PRODUCT_LIST: 60, // 1 минута для списка
    // Списки категорий: баланс между нагрузкой и скоростью навигации по каталогу
    CATEGORY_PRODUCTS: 120, // 2 минуты для продуктов по категории
  };

  /**
   * Справочник ключей кэширования Redis для модуля Products.
   * Централизованное управление ключами предотвращает коллизии имен в общем хранилище
   * и обеспечивает консистентность при инвалидации данных.
   */
  private readonly CACHE_KEYS = {
    // Глобальный список (используется для массовой инвалидации через Redis Pattern)
    // «Коллизии имен» защита от дублирования имен из разных сервисов через префикс
    // products:all решана эта проблема теперь имя уникально
    ALL_PRODUCTS: 'products:all',
    // Ключи для прямого доступа по ID (Primary Key)
    PRODUCT: (id: string) => `product:${id}`,
    // Ключи для SEO-оптимизированного поиска по Slug
    PRODUCT_BY_SLUG: (slug: string) => `product:slug:${slug}`,
    // Кэширование выборок по категориям (для оптимизации вложенных GraphQL запросов)
    CATEGORY_PRODUCTS: (categoryId: string) =>
      `category:${categoryId}:products`,
    // Атомарный счетчик общего количества товаров в системе
    PRODUCT_COUNT: 'products:count',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // При старте сервиса проверяем подключения
    this.logger.log('ProductService initialized');

    // Можно прогреть кэш популярных продуктов
    await this.warmUpCache();
  }

  // ==================== CRUD операции с кэшированием ====================

  /**
   * Получение всех продуктов с кэшированием
   * Получение полного каталога товаров с поддержкой многоуровневого кэширования.
   * Реализует паттерн Cache-Aside (сначала кэш, потом база) для снижения Read-нагрузки на основную БД.
   *
   * @returns Массив товаров с предварительно загруженными данными категорий
   */
  // Получаем все продукты
  async getAll(): Promise<Product[]> {
    const cacheKey = this.CACHE_KEYS.ALL_PRODUCTS;

    // Используем абстракцию RedisService для автоматизации логики "проверь кэш -> запрос в БД -> сохрани"
    return this.redisService.cache<Product[]>(
      cacheKey,
      async () => {
        this.logger.debug('Cache miss - fetching all products from database');
        return this.prisma.product.findMany({
          // Решение проблемы N+1: выполняем Eager Loading (жадную загрузку)
          // include здесь не просто так, а для предотвращения лавинообразных запросов к базе при отрисовке категорий в GraphQL.
          // связанных категорий через JOIN/Batch запрос на уровне БД.
          include: {
            category: true,
          },
          // Гарантируем предсказуемую сортировку для корректного кэширования
          // «предсказуемой сортировки»: если база вернет данные в разном порядке,
          // кэш может стать неконсистентным или бесполезным для пагинации.
          orderBy: { createdAt: 'desc' },
        });
      },
      this.CACHE_TTL.PRODUCT_LIST,
    );
  }

  /**
   * Получает данные продукта по его идентификатору.
   * Реализует паттерн Cache-Aside: сначала проверяет Redis, при отсутствии данных — запрашивает БД.
   *
   * @param {string} id - Уникальный идентификатор продукта.
   * @returns {Promise<Product | null>} Объект продукта или null, если продукт не найден.
   * @throws {Error} Может выбросить ошибку при сбое подключения к Redis или БД.
   */
  async byId(id: string): Promise<Product | null> {
    const cacheKey = this.CACHE_KEYS.PRODUCT(id);

    return this.redisService.cache<Product | null>(
      cacheKey,
      async () => {
        this.logger.debug(`Cache miss - fetching product ${id} from database`);
        return this.prisma.product.findUnique({
          where: { id },
        });
      },
      this.CACHE_TTL.PRODUCT,
    );
  }

  /**
   * Получает первый продукт с указанным именем.
   * Использует Eager Loading для подгрузки категории, предотвращая проблему N+1.
   *
   * @param {string} name - Название продукта для поиска.
   * @returns {Promise<Product | null>} Объект продукта с вложенной категорией или null.
   */
  async byName(name: string): Promise<Product | null> {
    const cacheKey = this.CACHE_KEYS.PRODUCT_BY_NAME(name);

    return this.redisService.cache<Product | null>(
      cacheKey,
      async () => {
        this.logger.debug(
          `Cache miss - fetching product by name ${name} from database`,
        );
        return this.prisma.product.findFist({
          where: { name },
          // РЕШЕНИЕ N+1:
          include: {
            category: true, // Решение N+1 для вложенного GraphQL запроса
          },
        });
      },
      this.CACHE_TTL.PRODUCT,
    );
  }

  /**
   * Извлечение данных товара по его уникальному SEO-идентификатору (slug).
   * Реализует стратегию кэширования "Cache-Aside" для минимизации нагрузки на БД.
   *
   * @param slug {string} Человекочитаемый URL-идентификатор товара (напр. "iphone-15-pro").
   * @returns {Promise<Product | null>} Объект товара из кэша/БД или null, если не найден.
   *
   * @description
   * 1. Генерирует уникальный ключ кэша на основе slug.
   * 2. Использует RedisService.cache для атомарной проверки наличия данных в Redis.
   * 3. При промахе кэша (Cache Miss) выполняет запрос к PostgreSQL через Prisma и
   *    автоматически сохраняет результат в Redis с заданным временем жизни (TTL).
   */
  async bySlug(slug: string): Promise<Product | null> {
    const cacheKey = this.CACHE_KEYS.PRODUCT_BY_SLUG(slug);

    return this.redisService.cache<Product | null>(
      cacheKey,
      async () => {
        this.logger.debug(
          `Cache miss - fetching product by slug ${slug} from database`,
        );
        return this.prisma.product.findUnique({
          where: { slug },
        });
      },
      this.CACHE_TTL.PRODUCT,
    );
  }

  /**
   * Создает новый продукт, обновляет кэш и уведомляет другие сервисы через Kafka.
   *
   * @async
   * @param {CreateProductDto} dto - Данные для создания продукта.
   * @returns {Promise<Product>} Созданный объект продукта.
   * @throws {ConflictException} Если продукт с таким slug уже существует.
   *
   * @description
   * Процесс выполнения:
   * 1. Проверяет уникальность slug в БД.
   * 2. Сохраняет продукт.
   * 3. Параллельно (Promise.all) инвалидирует кэш списка и прогревает кэш для нового объекта (ID/Slug).
   * 4. Публикует событие 'product.created' в Kafka для синхронизации с другими микросервисами.
   */
  async create(dto: CreateProductDto): Promise<Product> {
    try {
      // 1. Проверка уникальности (лучше делать через Prisma Exception, но так тоже ок)
      const existingProduct = await this.prisma.product.findUnique({
        where: { slug: dto.slug },
      });

      if (existingProduct) {
        throw new ConflictException(
          `Product with slug ${dto.slug} already exists`,
        );
      }

      // 2. Создание в БД
      const product = await this.prisma.product.create({
        data: {
          ...dto,
          price: Number(dto.price), // Упрощенное приведение к числу
        },
      });

      // 3. ПАРАЛЛЕЛЬНО: Инвалидация и Кэширование (ускоряем метод)
      await Promise.all([
        // Очищаем списки, так как состав продуктов изменился
        this.invalidateListCache(product.categoryId),

        // Кэшируем новый продукт сразу по двум ключам (ID и SLUG)
        this.redisService.set(
          this.CACHE_KEYS.PRODUCT(product.id),
          JSON.stringify(product),
          this.CACHE_TTL.PRODUCT,
        ),
        this.redisService.set(
          this.CACHE_KEYS.PRODUCT_BY_SLUG(product.slug),
          JSON.stringify(product),
          this.CACHE_TTL.PRODUCT,
        ),
      ]);

      // 4. Отправка в Kafka (используем наш интерфейс/DTO)
      await this.kafkaProducer.send('product.created', {
        event_type: 'PRODUCT_CREATED', // Используй константы, если внедрил их
        id: product.id,
        name: product.name,
        price: product.price,
        categoryId: product.categoryId,
        timestamp: new Date().toISOString(),
        // ... другие поля из твоего DTO
      });

      this.logger.log(`✅ Product created and synced: ${product.id}`);
      return product;
    } catch (error) {
      this.logger.error(`❌ Create failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Инвалидирует кэш списков продуктов при изменении данных.
   * Удаляет общий список всех продуктов и, опционально, список продуктов конкретной категории.
   *
   * @private
   * @param {string} [categoryId] - ID категории для точечной очистки кэша.
   * @returns {Promise<void>}
   */
  // Вспомогательный метод для очистки
  private async invalidateListCache(categoryId?: string) {
    const patterns = [this.CACHE_KEYS.ALL_PRODUCTS];
    if (categoryId) {
      patterns.push(this.CACHE_KEYS.CATEGORY_PRODUCTS(categoryId));
    }

    // Удаляем пачкой
    await Promise.all(
      patterns.map((p) => this.redisService.invalidatePattern(p)),
    );
  }

  /**
   * Обновление продукта
   *
   * Обновляет данные продукта, выполняя глубокую инвалидацию кэша и синхронизацию.
   *
   * @async
   * @param {string} id - UUID продукта.
   * @param {UpdateProductDto} dto - Данные для частичного обновления.
   * @returns {Promise<Product>} Обновленный объект продукта.
   * @throws {NotFoundException} Если продукт с таким ID отсутствует.
   * @throws {ConflictException} Если новый slug уже занят другим продуктом.
   *
   * @description
   * Особенности реализации:
   * - Проверяет уникальность slug при его смене.
   * - Выполняет параллельную очистку кэша: по ID, по старому/новому slug и списков категорий.
   * - Обрабатывает смену категории: инвалидирует кэш как старой, так и новой категории.
   * - Публикует событие 'product.updated' с передачей `oldCategoryId` для корректного пересчета агрегатов в других сервисах.
   */
  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    try {
      // 1. Сначала берем текущее состояние (нужно для Kafka и очистки кэша)
      const current = await this.prisma.product.findUnique({ where: { id } });
      if (!current) throw new NotFoundException(`Product ${id} not found`);

      // 2. Если слаг меняется, проверяем уникальность нового
      if (dto.slug && dto.slug !== current.slug) {
        const exists = await this.prisma.product.findUnique({
          where: { slug: dto.slug },
        });
        if (exists) throw new ConflictException(`Slug ${dto.slug} is taken`);
      }

      // 3. Обновляем в БД
      const updated = await this.prisma.product.update({
        where: { id },
        data: dto,
      });

      // 4. Глубокая инвалидация кэша (Parallel)
      await Promise.all([
        // Удаляем старый ID, старый Slug и новый Slug (на всякий случай)
        this.redisService.del(this.CACHE_KEYS.PRODUCT(id)),
        this.redisService.del(this.CACHE_KEYS.PRODUCT_BY_SLUG(current.slug)),
        dto.slug
          ? this.redisService.del(this.CACHE_KEYS.PRODUCT_BY_SLUG(dto.slug))
          : null,

        // Чистим списки (всегда, так как цена или имя могли измениться)
        this.invalidateListCache(current.categoryId),
        current.categoryId !== updated.categoryId
          ? this.invalidateListCache(updated.categoryId)
          : null,
      ]);

      // 5. Синхронизация через Kafka
      await this.kafkaProducer.send('product.updated', {
        event_type: 'PRODUCT_UPDATED',
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        price: updated.price,
        categoryId: updated.categoryId,
        oldCategoryId: current.categoryId, // КРИТИЧНО для счетчиков в CategoryService!
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`✅ Product updated and cache cleared: ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`❌ Update failed for ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Удаление продукта
   *
   * Удаляет продукт из базы данных, полностью вычищает связанный кэш и уведомляет систему.
   *
   * @async
   * @param {string} id - Уникальный идентификатор удаляемого продукта.
   * @returns {Promise<Product>} Объект удаленного продукта.
   * @throws {NotFoundException} Если продукт для удаления не найден.
   *
   * @description
   * Порядок действий:
   * 1. Предварительный поиск продукта для получения метаданных (slug, categoryId).
   * 2. Удаление записи из Prisma.
   * 3. Асинхронная очистка кэша: удаление индивидуальных ключей (ID, Slug) и инвалидация списков.
   * 4. Отправка события 'product.deleted' в Kafka для синхронизации зависимых сервисов.
   */

  async delete(id: string): Promise<Product> {
    try {
      // 1. Сначала находим товар, чтобы знать, какой slug и категорию чистить
      const product = await this.prisma.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException(`Product ${id} not found`);

      // 2. Удаляем из БД
      const deletedProduct = await this.prisma.product.delete({
        where: { id },
      });

      // 3. ПАРАЛЛЕЛЬНО: Выжигаем кэш (не ждем по очереди)
      await Promise.all([
        this.redisService.del(this.CACHE_KEYS.PRODUCT(id)),
        this.redisService.del(this.CACHE_KEYS.PRODUCT_BY_SLUG(product.slug)),
        this.invalidateListCache(product.categoryId), // Чистим общий список и список категории
      ]);

      // 4. Уведомляем Kafka
      await this.kafkaProducer.send('product.deleted', {
        event_type: 'PRODUCT_DELETED',
        id: product.id,
        name: product.name,
        categoryId: product.categoryId,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`🗑️ Product ${id} deleted and synced`);
      return deletedProduct;
    } catch (error) {
      this.logger.error(`❌ Delete failed for ${id}:`, error.message);
      throw error;
    }
  }

  // ==================== Дополнительные методы с кэшированием ====================

  /**
   * Возвращает список продуктов, принадлежащих конкретной категории.
   * Реализует кэширование списка с автоматической сортировкой по дате создания.
   *
   * @param {string} categoryId - Идентификатор категории.
   * @returns {Promise<Product[]>} Массив продуктов. Возвращает пустой массив, если продуктов в категории нет.
   *
   * @description
   * Данные сортируются по убыванию даты создания (сначала новые).
   * Кэш этого метода инвалидируется автоматически методом `invalidateListCache`
   * при создании, обновлении или удалении продукта в данной категории.
   */
  async getByCategory(categoryId: string): Promise<Product[]> {
    const cacheKey = this.CACHE_KEYS.CATEGORY_PRODUCTS(categoryId);

    return this.redisService.cache<Product[]>(
      cacheKey,
      async () => {
        this.logger.debug(
          `Cache miss - fetching products for category ${categoryId}`,
        );
        return this.prisma.product.findMany({
          where: { categoryId },
          orderBy: { createdAt: 'desc' },
        });
      },
      this.CACHE_TTL.CATEGORY_PRODUCTS,
    );
  }

  /**
   * Поиск продуктов с пагинацией (с кэшированием)
   *
   * Выполняет полнотекстовый поиск продуктов с поддержкой пагинации и кэширования.
   * Поиск ведется по полям: name, description и sku (регистронезависимо).
   *
   * @async
   * @param {string} query - Поисковый запрос.
   * @param {number} [page=1] - Номер страницы (начиная с 1).
   * @param {number} [limit=20] - Количество элементов на странице.
   * @returns {Promise<{items: Product[], total: number, page: number, totalPages: number}>}
   * Объект с массивом продуктов и метаданными пагинации.
   *
   * @description
   * - Результаты кэшируются на короткий срок (30 секунд) для снижения нагрузки при типичных запросах.
   * - Использует `Promise.all` для параллельного получения данных и общего количества записей.
   * - Сортировка по умолчанию: сначала новые (`createdAt: desc`).
   */
  async search(
    query: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    items: Product[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const cacheKey = `products:search:${query}:page:${page}:limit:${limit}`;

    return this.redisService.cache(
      cacheKey,
      async () => {
        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
          this.prisma.product.findMany({
            where: {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.product.count({
            where: {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
              ],
            },
          }),
        ]);

        return {
          items,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        };
      },
      30, // Кэшируем поиск на 30 секунд
    );
  }

  /**
   * Проверка наличия на складе
   *
   * Проверяет доступность указанного количества товара на складе.
   * Использует кэшированные данные продукта для минимизации нагрузки на БД.
   *
   * @async
   * @param {string} id - Идентификатор проверяемого продукта.
   * @param {number} [quantity=1] - Требуемое количество единиц товара.
   * @returns {Promise<{available: boolean, currentStock: number, requested: number}>}
   * Результат проверки: флаг доступности, текущий остаток и запрошенное количество.
   *
   * @throws {Error} Если продукт с указанным ID не найден.
   */
  async checkStock(
    id: string,
    quantity: number = 1,
  ): Promise<{
    available: boolean;
    currentStock: number;
    requested: number;
  }> {
    const product = await this.byId(id);

    if (!product) {
      throw new Error(`Product ${id} not found`);
    }

    const currentStock = product.stockCount || 0;

    return {
      available: currentStock >= quantity,
      currentStock,
      requested: quantity,
    };
  }

  /**
   * Обновление количества на складе
   *
   * Обновляет количество товара на складе и синхронизирует состояние доступности.
   *
   * @async
   * @param {string} id - Уникальный идентификатор продукта.
   * @param {number} quantity - Новое количество товара на складе.
   * @returns {Promise<Product>} Обновленный объект продукта.
   * @throws {Error} Если продукт не найден или произошла ошибка БД/Kafka.
   *
   * @description
   * - Автоматически вычисляет флаг `inStock` (true, если quantity > 0).
   * - Выполняет инвалидацию кэша продукта по ID и Slug.
   * - Публикует событие 'product.stock.updated' в Kafka для систем управления заказами и уведомлений.
   */
  async updateStock(id: string, quantity: number): Promise<Product> {
    try {
      const product = await this.prisma.product.update({
        where: { id },
        data: {
          stockCount: quantity,
          inStock: quantity > 0,
        },
      });

      this.logger.log(`📦 Stock updated for ${product.name}: ${quantity}`);

      // Инвалидируем кэш
      await this.invalidateProductCache(id, product.slug);

      // Отправляем событие об изменении стока
      await this.kafkaProducer.send('product.stock.updated', {
        id: product.id,
        stockCount: quantity,
        inStock: quantity > 0,
        event_type: 'product.stock.updated',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });

      return product;
    } catch (error) {
      this.logger.error(`❌ Error updating stock for ${id}:`, error);
      throw error;
    }
  }

  /**
   * Получение популярных продуктов (с кэшированием)
   *
   * Возвращает список популярных продуктов, доступных в наличии.
   * Использует долгосрочное кэширование (5 минут) для снижения нагрузки на тяжелые выборки.
   *
   * @async
   * @param {number} [limit=10] - Максимальное количество возвращаемых продуктов.
   * @returns {Promise<Product[]>} Массив популярных продуктов.
   *
   * @description
   * - Фильтрует только товары в наличии (`inStock: true`).
   * - Текущая реализация использует сортировку по дате создания (новые как популярные).
   * - В будущем планируется внедрение метрик (просмотры, заказы) для более точного ранжирования.
   */
  async getPopularProducts(limit: number = 10): Promise<Product[]> {
    const cacheKey = `products:popular:limit:${limit}`;

    return this.redisService.cache<Product[]>(
      cacheKey,
      async () => {
        // Здесь можно добавить логику подсчета популярности
        // Например, по количеству просмотров или заказов
        return this.prisma.product.findMany({
          where: { inStock: true },
          orderBy: { createdAt: 'desc' }, // Временно, потом заменить на реальные метрики
          take: limit,
        });
      },
      300, // 5 минут
    );
  }

  // ==================== Приватные методы ====================

  /**
   * Инвалидация кэша продукта
   * Защита от «грязных данных» которые вынесены в отдельные private методы.
   * Теперь, если нужно добавить кэширование по цене или по бренду,
   * нужно будет изменить код только в одном месте (в этом методе),
   * и во всем сервисе инвалидация обновится автоматически.
   */
  private async invalidateProductCache(
    id: string,
    slug: string,
  ): Promise<void> {
    await Promise.all([
      this.redisService.del(this.CACHE_KEYS.PRODUCT(id)),
      this.redisService.del(this.CACHE_KEYS.PRODUCT_BY_SLUG(slug)),
    ]);

    this.logger.debug(`Cache invalidated for product ${id}`);
  }

  /**
   * Инвалидация кэша списков
   * В invalidateListCache используем паттерн products:*. Это
   *  очистит, но, что когда ключей станут миллионы, лучше будет
   *  перейти на SCAN вместо KEYS. Пока для старта — это идеально.
   * Выполняет массовую инвалидацию кэша списков продуктов.
   * Очищает все ключи, соответствующие паттерну 'products:*'.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @description
   * Текущая реализация использует поиск по паттерну.
   * ВАЖНО: При масштабировании до миллионов ключей необходимо заменить
   * механизм KEYS на SCAN или перейти на инвалидацию через Redis Tags (Sets),
   * чтобы избежать блокировки основного потока Redis.
   */
  private async invalidateListCache(): Promise<void> {
    await this.redisService.invalidatePattern('products:*');
    this.logger.debug('List cache invalidated');
  }

  /**
   * Получение изменений между старой и новой версией продукта
   * Вычисляет разницу между двумя состояниями продукта.
   * Используется для формирования детального лога изменений или точечных уведомлений в Kafka.
   *
   * @private
   * @param {Product} oldProduct - Исходное состояние объекта из базы данных.
   * @param {Product} newProduct - Обновленное состояние объекта после сохранения.
   * @returns {Record<string, {old: any, new: any}>} Объект с измененными полями и их значениями.
   *
   * @description
   * Сравнение производится по белому списку полей: name, price, description, categoryId, sku.
   * Для корректного сравнения объектов и массивов используется JSON-сериализация.
   */
  private getChanges(
    oldProduct: Product,
    newProduct: Product,
  ): Record<string, any> {
    const changes: Record<string, any> = {};

    const fieldsToCompare = [
      'name',
      'price',
      'description',
      'categoryId',
      'sku',
    ];

    for (const field of fieldsToCompare) {
      if (
        JSON.stringify(oldProduct[field]) !== JSON.stringify(newProduct[field])
      ) {
        changes[field] = {
          old: oldProduct[field],
          new: newProduct[field],
        };
      }
    }

    return changes;
  }

  /**
   * Прогрев кэша (загрузка популярных данных при старте)
   * Инициализирует кэш наиболее востребованными данными при запуске сервиса.
   * Реализует стратегию "прогрева" (Cache Warming) для снижения Latency первых запросов.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @description
   * Алгоритм работы:
   * 1. Извлекает топ-10 последних продуктов из БД.
   * 2. Сохраняет агрегированный список популярных товаров.
   * 3. Индивидуально кэширует каждый продукт по его ID (атомарный прогрев).
   *
   * Используется блок try-catch, чтобы сбой прогрева кэша не блокировал запуск всего микросервиса.
   */
  private async warmUpCache(): Promise<void> {
    try {
      this.logger.log('🔥 Warming up cache...');

      // Загружаем популярные продукты
      const popularProducts = await this.prisma.product.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (popularProducts.length > 0) {
        await this.redisService.set(
          'products:popular:limit:10',
          JSON.stringify(popularProducts),
          300,
        );

        // Кэшируем каждый популярный продукт отдельно
        for (const product of popularProducts) {
          await this.redisService.set(
            this.CACHE_KEYS.PRODUCT(product.id),
            JSON.stringify(product),
            this.CACHE_TTL.PRODUCT,
          );
        }
      }

      this.logger.log('✅ Cache warmed up successfully');
    } catch (error) {
      this.logger.warn('⚠️ Cache warm-up failed:', error.message);
    }
  }
}
