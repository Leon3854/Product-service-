/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Logger,
} from '@nestjs/common';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KafkaProducerService } from './kafka.producer.service';
import { AnyProductEvent } from './dto/product-created.event.dto';
import { ProductGateway } from '../product/gateways/product.gateway';
@Injectable()
export class ProductConsumer
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ProductConsumer.name);
  private consumer: Consumer;

  constructor(
    private readonly kafkaProducer: KafkaProducerService, // Внедряем продюсер, чтобы отправлять ответные события
    private readonly productGateway: ProductGateway, // Внедряем наш шлюз
  ) {
    const kafka = new Kafka({
      clientId: 'product-service-consumer',
      brokers: ['kafka:9092'],
    });

    this.consumer = kafka.consumer({ groupId: 'product-group' });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();
      this.logger.log('✅ Kafka Consumer connected');
    } catch (e) {
      this.logger.error('❌ Kafka connection failed', e.message);
    }
  }

  async onApplicationBootstrap() {
    try {
      await this.consumer.subscribe({
        topics: ['product.created', 'product.updated', 'product.deleted'],
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });
      this.logger.log('🚀 Listening for product events...');
    } catch (e) {
      this.logger.error('❌ Failed to start consumer loop', e.message);
    }
  }

  // Основной распределитель
  // Это основной распределитель, сортировщик
  // решает куда будет отдано сообщение
  private async handleMessage({ topic, message }: EachMessagePayload) {
    try {
      if (!message?.value) return;

      // 2. Указываем TypeScript, что переменная event соответствует нашему Мастер-типу
      const event: AnyProductEvent = JSON.parse(message.value.toString());

      this.logger.log(`📨 [${topic}] Received event: ${event.id}`);

      // 3. Теперь внутри switch TypeScript будет точно знать тип каждого события
      switch (topic) {
        case 'product.created':
          // Здесь TS знает, что это ProductCreatedDto
          await this.handleProductCreated(event);
          break;

        case 'product.updated':
          // Здесь TS поймет, что это ProductUpdatedDto
          await this.handleProductUpdated(event);
          break;

        case 'product.deleted':
          // Здесь TS поймет, что это ProductDeletedDto
          await this.handleProductDeleted(event);
          break;

        default:
          this.logger.warn(`⚠️ Unknown topic: ${topic}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error parsing/processing ${topic}:`, error.message);
    }
  }

  // 1. Обработка создания
  // генерирует новое сообщение читает что происходит с товаром

  private async handleProductCreated(event: ProductCreatedDto) {
    this.logger.log(`🆕 Handling created event for product: ${event.name}`);
    try {
      // Теперь TS знает, что у event точно есть categoryId и name
      await this.kafkaProducer.send('category.product.count.increment', {
        categoryId: event.categoryId,
        productId: event.id,
        productName: event.name,
        timestamp: event.timestamp, // Используем время из самого события
      });
      this.logger.log(`📊 Category [${event.categoryId}] incremented`);
      //
      // НОВОЕ: Отправляем пуш-уведомление на фронтенд в реальном времени
      this.productGateway.notifyProductCreated(event);
    } catch (error) {
      this.logger.error(
        `❌ Error incrementing category [${event.categoryId}]:`,
        error.message,
      );
    }
  }

  // 2. Обработка обновления (смена категории)
  private async handleProductUpdated(event: ProductUpdatedDto) {
    this.logger.log(`✏️ Handling updated event for product: ${event.id}`);
    try {
      // Проверка смены категории стала безопасной благодаря типизации
      if (event.oldCategoryId && event.oldCategoryId !== event.categoryId) {
        // Уменьшаем в старой
        await this.kafkaProducer.send('category.product.count.decrement', {
          categoryId: event.oldCategoryId,
          productId: event.id,
        });

        // Увеличиваем в новой
        await this.kafkaProducer.send('category.product.count.increment', {
          categoryId: event.categoryId,
          productId: event.id,
          productName: event.name,
        });

        this.logger.log(
          `🔄 Moved: ${event.oldCategoryId} -> ${event.categoryId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error updating categories for product ${event.id}:`,
        error.message,
      );
    }
  }

  // 3. Обработка удаления
  private async handleProductDeleted(event: ProductDeletedDto) {
    this.logger.log(`🗑️ Handling deleted event for product: ${event.id}`);
    try {
      await this.kafkaProducer.send('category.product.count.decrement', {
        categoryId: event.categoryId,
        productId: event.id,
      });
      this.logger.log(`📊 Category [${event.categoryId}] decremented`);
    } catch (error) {
      this.logger.error(
        `❌ Error decrementing category [${event.categoryId}]:`,
        error.message,
      );
    }
  }

  async onModuleDestroy() {
    await this.consumer.disconnect();
    this.logger.log('👋 Consumer stopped');
  }
}
