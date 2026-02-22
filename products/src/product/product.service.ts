import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { Product } from './types/product.graphql-types';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  // Константы для кэширования
  private readonly CACHE_TTL = {
    PRODUCT: 300, // 5 минут для отдельного продукта
    PRODUCT_LIST: 60, // 1 минута для списка
    CATEGORY_PRODUCTS: 120, // 2 минуты для продуктов по категории
  };

  private readonly CACHE_KEYS = {
    ALL_PRODUCTS: 'products:all',
    PRODUCT: (id: string) => `product:${id}`,
    PRODUCT_BY_SLUG: (slug: string) => `product:slug:${slug}`,
    CATEGORY_PRODUCTS: (categoryId: string) =>
      `category:${categoryId}:products`,
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
   */
  // Получаем все продукты
  async getAll(): Promise<Product[]> {
    const cacheKey = this.CACHE_KEYS.ALL_PRODUCTS;

    // Используем cache() метод из RedisService для автоматического кэширования
    return this.redisService.cache<Product[]>(
      cacheKey,
      async () => {
        this.logger.debug('Cache miss - fetching all products from database');
        return this.prisma.product.findMany({
          // N+1
          include: {
            category: true,
          },
          orderBy: { createdAt: 'desc' },
        });
      },
      this.CACHE_TTL.PRODUCT_LIST,
    );
  }

  /**
   * Получение продукта по ID с кэшированием
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
   * Получение всех по имени с кэшированием
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
   * Получение продукта по slug с кэшированием
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
   * Создание продукта
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
   * Получение продуктов по категории с кэшированием
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

   */
  private async invalidateListCache(): Promise<void> {
    await this.redisService.invalidatePattern('products:*');
    this.logger.debug('List cache invalidated');
  }

  /**
   * Получение изменений между старой и новой версией продукта
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
