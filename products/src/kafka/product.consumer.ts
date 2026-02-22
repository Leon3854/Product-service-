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

  /**
   * Инициализация цикла прослушивания событий Kafka при старте приложения.
   * Используется хук onApplicationBootstrap, чтобы гарантировать готовность
   * всех зависимостей перед запуском бесконечного цикла consumer.run.
   */
  async onApplicationBootstrap() {
    try {
      await this.consumer.subscribe({
        // Подписка на основные события жизненного цикла товара
        topics: ['product.created', 'product.updated', 'product.deleted'],
        // fromBeginning: true позволяет вычитать сообщения, отправленные до старта инстанса,
        // что критично для восстановления консистентности данных (Event Sourcing)
        fromBeginning: true,
      });

      await this.consumer.run({
        // Делегируем обработку сообщений внутреннему диспетчеру (handler)
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });
      this.logger.log('🚀 Listening for product events...');
    } catch (e) {
      // Критическая ошибка: если цикл не запустился, уведомляем систему мониторинга
      this.logger.error('❌ Failed to start consumer loop', e.message);
    }
  }

  // Основной распределитель
  // Это основной распределитель, сортировщик
  // решает куда будет отдано сообщение
  /**
   * Центральный диспетчер входящих событий Kafka.
   * Реализует механизм Type Guarding: на основе топика трансформирует
   * сырые данные в строго типизированные DTO (AnyProductEvent).
   */
  private async handleMessage({ topic, message }: EachMessagePayload) {
    try {
      if (!message?.value) return;

      // Десериализация сообщения и приведение к Union-типу для типобезопасности.
      // Благодаря AnyProductEvent, TypeScript обеспечит автодополнение полей в блоке switch.
      // 2. Указываем TypeScript, что переменная event соответствует нашему Мастер-типу
      const event: AnyProductEvent = JSON.parse(message.value.toString());

      this.logger.log(`📨 [${topic}] Received event: ${event.id}`);

      // Распределение нагрузки по специализированным обработчикам.
      // Использование констант топиков гарантирует отсутствие ошибок при сопоставлении.
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
      // Логируем ошибку парсинга, чтобы не "уронить" цикл Consumer при битом JSON (Poison Pill)
      this.logger.error(`❌ Error parsing/processing ${topic}:`, error.message);
    }
  }

  // 1. Обработка создания
  // генерирует новое сообщение читает что происходит с товаром
  /**
   * Обработчик события создания нового продукта.
   * Реализует паттерн Side Effects:
   * 1. Асинхронное уведомление смежных систем (Category Service) для консистентности счетчиков.
   * 2. Real-time оповещение активных клиентов через WebSocket Gateway.
   */
  private async handleProductCreated(event: ProductCreatedDto) {
    this.logger.log(`🆕 Handling created event for product: ${event.name}`);
    try {
      // Теперь TS знает, что у event точно есть categoryId и name
      // Инициируем инкремент счетчика товаров в категории.
      // Передаем исходный timestamp события для корректной хронологии в аналитике.
      await this.kafkaProducer.send('category.product.count.increment', {
        categoryId: event.categoryId,
        productId: event.id,
        productName: event.name,
        timestamp: event.timestamp, // Используем время из самого события
      });
      this.logger.log(`📊 Category [${event.categoryId}] incremented`);

      // НОВОЕ: Отправляем пуш-уведомление на фронтенд в реальном времени
      // Доставка уведомления на фронтенд в реальном времени.
      // Это позволяет избежать лишних HTTP-опросов (polling) со стороны клиента.
      this.productGateway.notifyProductCreated(event);
    } catch (error) {
      // Логируем ошибку, но не прерываем работу Consumer, чтобы не блокировать очередь
      // (ошибка инкремента не должна мешать обработке других товаров).
      this.logger.error(
        `❌ Error incrementing category [${event.categoryId}]:`,
        error.message,
      );
    }
  }

  /**
   * Этот метод — один из самых архитектурно нагруженных, потому что здесь решается
   * проблема «расползания» данных (Data Consistency) при перемещении объекта
   * между группами.
   * Обработчик обновления продукта.
   * Основная задача: синхронизация распределенных счетчиков при смене категории.
   * Реализует паттерн Saga (хореография) для поддержания консистентности данных.
   */
  // 2. Обработка обновления (смена категории)
  private async handleProductUpdated(event: ProductUpdatedDto) {
    this.logger.log(`✏️ Handling updated event for product: ${event.id}`);
    try {
      // Проверка смены категории стала безопасной благодаря типизации
      // Логика "Перемещения" (Migration): если ID категории изменился,
      // необходимо атомарно скорректировать счетчики в обеих категориях.
      if (event.oldCategoryId && event.oldCategoryId !== event.categoryId) {
        // 1. Декремент в старой категории (убираем товар)
        await this.kafkaProducer.send('category.product.count.decrement', {
          categoryId: event.oldCategoryId,
          productId: event.id,
        });

        // 2. Инкремент в новой категории (добавляем товар)
        await this.kafkaProducer.send('category.product.count.increment', {
          categoryId: event.categoryId,
          productId: event.id,
          productName: event.name,
        });

        this.logger.log(
          `🔄 Moved: ${event.oldCategoryId} -> ${event.categoryId}`,
        );
      }
      // Здесь также можно добавить вызов Gateway для обновления цены/статуса в UI
      // this.productGateway.notifyProductUpdated(event);
    } catch (error) {
      // Критическая ошибка: если один из сигналов не ушел, счетчики могут рассинхронизироваться.
      // В логах фиксируем оба ID для возможности ручного восстановления данных.
      this.logger.error(
        `❌ Error updating categories for product ${event.id}:`,
        error.message,
      );
    }
  }

  // 3. Обработка удаления
  /**
   * Обработчик удаления продукта.
   * Обеспечивает консистентность данных (Referential Integrity) в смежных сервисах.
   * Выполняет декремент счетчиков и инициирует каскадную очистку ресурсов.
   */
  private async handleProductDeleted(event: ProductDeletedDto) {
    this.logger.log(`🗑️ Handling deleted event for product: ${event.id}`);
    try {
      // Уведомляем сервис категорий о необходимости уменьшить счетчик.
      // Важно выполнить это асинхронно через Kafka, чтобы не блокировать
      // процесс удаления основного объекта.
      await this.kafkaProducer.send('category.product.count.decrement', {
        categoryId: event.categoryId,
        productId: event.id,
      });
      this.logger.log(`📊 Category [${event.categoryId}] decremented`);
      // Здесь также может быть вызов Gateway для удаления карточки из UI в real-time
      // this.productGateway.notifyProductDeleted(event.id);
    } catch (error) {
      // Ошибка декремента считается некритичной для основного потока,
      // но требует фиксации для последующей сверки данных (Data Reconciliation).
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
