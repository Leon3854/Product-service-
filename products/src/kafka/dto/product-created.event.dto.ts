import {
  ProductCreatedEvent,
  ProductUpdatedEvent,
  ProductDeletedEvent,
} from '../interface/product-events.interface';

// 1. Базовый класс для общих полей (DRY - Don't Repeat Yourself)
class BaseProductEvent {
  readonly id: string;
  readonly timestamp: string = new Date().toISOString();
  readonly version: number = 1;
}

// 2. Конкретные DTO, которые реализуют твои интерфейсы
export class ProductCreatedDto
  extends BaseProductEvent
  implements ProductCreatedEvent
{
  readonly event_type: 'PRODUCT_CREATED' = 'PRODUCT_CREATED';
  readonly name: string;
  readonly description?: string | null;
  readonly price: number;
  readonly categoryId: string; // Добавили для Category Service
}

export class ProductUpdatedDto
  extends BaseProductEvent
  implements ProductUpdatedEvent
{
  readonly event_type: 'PRODUCT_UPDATED' = 'PRODUCT_UPDATED';
  readonly name: string;
  readonly description?: string | null;
  readonly price: number;
  readonly categoryId: string;
  readonly oldCategoryId?: string; // Поле для логики смены категории
}

export class ProductDeletedDto
  extends BaseProductEvent
  implements ProductDeletedEvent
{
  readonly event_type: 'PRODUCT_DELETED' = 'PRODUCT_DELETED';
  readonly name: string;
  readonly price: number;
  readonly categoryId: string;
}

// 3. "Мастер-тип" (Union Type) - самое удобное для Consumer
export type AnyProductEvent =
  | ProductCreatedDto
  | ProductUpdatedDto
  | ProductDeletedDto;
