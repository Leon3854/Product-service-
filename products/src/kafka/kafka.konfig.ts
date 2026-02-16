/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { KafkaOptions, Transport } from '@nestjs/microservices';

// конфиг описывает «как» и «куда» мы подключаемся (настройки почтового отделения).
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
