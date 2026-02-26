/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { KafkaOptions, Transport } from '@nestjs/microservices';

// конфиг описывает «как» и «куда» мы подключаемся (настройки почтового отделения).
/**
 * Конфигурация транспортного уровня для взаимодействия с Apache Kafka.
 * Определяет параметры подключения ("адрес почтового отделения") и
 * настройки идентификации сервиса в кластере. [INDEX 1]
 *
 * @property {string} name - Уникальное имя инстанса микросервиса в DI-контейнере NestJS.
 * @property {Transport} transport - Тип используемого протокола связи (KAFKA). [INDEX 2]
 * @property {object} options - Технические параметры брокера:
 *   - clientId: имя отправителя для отслеживания логов на стороне Kafka.
 *   - brokers: список адресов (seed nodes) для первичного подключения. [INDEX 3]
 *   - groupId: идентификатор группы консьюмеров для балансировки нагрузки. [INDEX 4]
 */
export const kafkaConfig: KafkaOptions & { name: string } = {
  name: 'KAFKA_SERVICE',
  transport: Transport.KAFKA,
  options: {
    client: {
      clientId: 'products-service',
      brokers: ['kafka:9092'],
    },
    consumer: {
      groupId: 'products-consumer-group',
    },
  },
};
