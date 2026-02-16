/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import {
  ProductCreatedEvent,
  ProductDeletedEvent,
  ProductUpdatedEvent,
} from './interface/product-events.interface';

// Создаем тип-объединение для всех возможных событий продукта
type ProductEvent =
  | ProductCreatedEvent
  | ProductUpdatedEvent
  | ProductDeletedEvent;
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleInit {
  // Logger: главный помощник в микросервисах. Без него в Docker-контейнере
  // никогда не узнаешь, почему сервис не работает. Он выводит красивые логи
  // с меткой времени и именем сервиса.
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'products-service',
      brokers: ['kafka:9092'],
    });

    this.producer = kafka.producer();
  }

  // хук жизненного цикла (вход в систему)
  async onModuleInit(): Promise<void> {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        await this.producer.connect();
        this.logger.log('✅ Kafka Producer connected successfully');
        return; // Выходим из метода, если всё ок
      } catch (error) {
        retries++;
        this.logger.error(
          `❌ Failed to connect Kafka (Attempt ${retries}/${maxRetries}):`,
          error.message,
        );

        if (retries < maxRetries) {
          // Ждем 3 секунды перед следующей попыткой
          await new Promise((res) => setTimeout(res, 3000));
        } else {
          this.logger.error(
            'Critical: Could not connect to Kafka after several attempts.',
          );
          // Тут можно либо бросить ошибку, либо оставить как есть (зависит от критичности Kafka)
        }
      }
    }
  }

  // хук жизненного цикла(выход из системы)
  async onModuleDestroy(): Promise<void> {
    try {
      await this.producer.disconnect();
      this.logger.log('✅ Kafka Producer disconnected successfully');
    } catch (error) {
      this.logger.error(
        '❌ Error during Kafka Producer disconnection:',
        error.message,
      );
    }
  }

  async send(topic: string, message: ProductEvent): Promise<void> {
    try {
      const record = {
        topic,
        messages: [
          {
            // Добавляем ключ (key). Это важно для масштабирования!
            // Сообщения с одинаковым ключом (например, ID товара)
            // всегда попадут в один и тот же раздел (Partition) Kafka.
            key: message.id,
            value: JSON.stringify(message),
          },
        ],
      };

      await this.producer.send(record);
      this.logger.log(
        `✅ Message [${message.event_type}] sent to topic: ${topic}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Error sending message to topic ${topic}:`,
        error.stack,
      );
      // ВАЖНО: В  микросервисе ,
      //  пробрасываем ошибку дальше (throw error),
      // чтобы основной процесс знал, что данные НЕ ушли.
      // ПРОБРОС ОШИБКИ ДАЛЬШЕ
      throw new Error(`Failed to publish event to Kafka: ${error.message}`);
    }
  }
}
