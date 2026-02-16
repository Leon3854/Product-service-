// src/kafka/interface/product-events.interface.ts
export interface ProductCreatedEvent {
  // типизируем событие. Любой микросервис,
  // который получит событие PRODUCT_CREATED,
  // будет точно знать, что там есть id, name и price.
  event_type: 'PRODUCT_CREATED';
  id: string;
  name: string;
  description?: string | null;
  price: number;
}

export interface ProductUpdatedEvent {
  event_type: 'PRODUCT_UPDATED';
  id: string;
  name: string;
  description?: string | null;
  price: number;
}

export interface ProductDeletedEvent {
  event_type: 'PRODUCT_DELETED';
  id: string;
  name: string;
  description?: string | null;
  price: number;
}
