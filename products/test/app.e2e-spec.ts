import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { KafkaProducerService } from '../src/kafka/kafka.producer.service';

describe('Product E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Мокаем Кафку, чтобы тест не завис на попытке подключения
  const mockKafka = { send: jest.fn().mockResolvedValue(null) };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KafkaProducerService) // Подменяем реальную Кафку на мок
      .useValue(mockKafka)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/products (POST) - создание товара', async () => {
    const payload = {
      name: 'iPhone 15',
      price: 1000,
      slug: 'iphone-15',
      categoryId: 'some-uuid',
    };

    return request(app.getHttpServer())
      .post('/products')
      .send(payload)
      .expect(201)
      .then((res) => {
        expect(res.body.name).toBe(payload.name);
        expect(mockKafka.send).toHaveBeenCalled(); // Проверяем, что событие ушло
      });
  });
});
