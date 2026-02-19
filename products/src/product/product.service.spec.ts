import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { ConfigService } from '@nestjs/config';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: PrismaService;
  let redis: RedisService;
  let kafka: KafkaProducerService;

  // Создаем моки для всех зависимостей
  const mockPrisma = {
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockRedis = {
    cache: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    invalidatePattern: jest.fn(),
  };

  const mockKafka = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        ConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: KafkaProducerService, useValue: mockKafka },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);
    kafka = module.get<KafkaProducerService>(KafkaProducerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Тестируем получение по ID
  describe('byId', () => {
    it('должен вернуть продукт из кэша, если он там есть', async () => {
      const mockProduct = { id: '1', name: 'Test Product' };
      mockRedis.cache.mockResolvedValue(mockProduct);

      const result = await service.byId('1');

      expect(result).toEqual(mockProduct);
      expect(redis.cache).toHaveBeenCalled();
    });
  });

  // Тестируем создание продукта
  describe('create', () => {
    it('должен выбросить ошибку, если продукт с таким slug уже существует', async () => {
      const dto = {
        name: 'Iphone 15',
        price: 1000,
        slug: 'iphone-15',
        categoryId: 'electronics',
      };

      // Имитируем, что такой slug УЖЕ найден в базе
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'existing-id',
        ...dto,
      });

      // Проверяем, что вызов метода приведет к ошибке
      await expect(service.create(dto as any)).rejects.toThrow(
        'Product with slug iphone-15 already exists',
      );

      // Гарантируем, что создание в БД НЕ было вызвано
      expect(prisma.product.create).not.toHaveBeenCalled();
      // И в Kafka ничего не улетело
      expect(kafka.send).not.toHaveBeenCalled();
    });
    it('должен выбросить ошибку, если Prisma упала при создании', async () => {
      const dto = {
        name: 'Fail Product',
        price: 50,
        slug: 'fail',
        categoryId: 'cat',
      };

      mockPrisma.product.findUnique.mockResolvedValue(null); // Slug свободен
      // Имитируем ошибку базы данных (например, разрыв соединения)
      mockPrisma.product.create.mockRejectedValue(
        new Error('DB Connection lost'),
      );

      await expect(service.create(dto as any)).rejects.toThrow(
        'DB Connection lost',
      );

      // Проверяем, что логгер зафиксировал ошибку
      // (Если ты используешь logger в сервисе, можно проверить и его)
    });
  });

  describe('byId (negative cases)', () => {
    it('должен вернуть null, если продукта нет ни в кэше, ни в базе', async () => {
      mockRedis.cache.mockImplementation((key, fn) => fn()); // Обходим кэш, вызываем функцию БД
      mockPrisma.product.findUnique.mockResolvedValue(null); // В базе тоже пусто

      const result = await service.byId('non-existent-id');

      expect(result).toBeNull();
    });
  });
});
