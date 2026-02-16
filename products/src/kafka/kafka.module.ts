import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka.producer.service';
import { ProductConsumer } from './product.consumer';

@Module({
  exports: [KafkaProducerService],
  providers: [KafkaProducerService, ProductConsumer],
})
export class KafkaModule {}
