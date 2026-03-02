import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

// Настраиваем шлюз. cors: true нужен, чтобы фронтенд мог подключиться
/**
 * Шлюз для работы с вебсокетами в контексте продуктов.
 * Обеспечивает передачу обновлений в реальном времени (Real-time) подключенным клиентам.
 *
 * @class ProductGateway
 * @namespace products - Пространство имен для изоляции трафика продуктов.
 */
@WebSocketGateway({
  namespace: 'products',
  cors: { origin: '*' },
})
export class ProductGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ProductGateway.name);

  // Метод, который мы будем вызывать из Consumer
  /**
   * Рассылает уведомление всем подключенным клиентам о создании нового продукта.
   * Вызывается асинхронно при получении события из Kafka или после сохранения в БД.
   *
   * @event product_created
   * @param {any} product - Объект созданного продукта (DTO).
   */
  notifyProductCreated(product: any) {
    this.server.emit('product_created', product);
    this.logger.log(`📢 Broadcast: Product ${product.id} sent to clients`);
  }

  /**
   * Уведомляет клиентов об изменении остатков на складе для конкретного товара.
   * Позволяет фронтенду мгновенно обновить статус "В наличии" без перезагрузки страницы.
   *
   * @event stock_updated
   * @param {Object} data - Данные обновления стока.
   * @param {string} data.id - ID продукта.
   * @param {number} data.stockCount - Новое количество.
   * @param {boolean} data.inStock - Флаг доступности.
   */
  notifyStockUpdated(data: any) {
    this.server.emit('stock_updated', data);
  }

  // Служебные хуки

  /**
   * Инициализация сервера сокетов.
   */
  afterInit(server: Server) {
    this.logger.log('✅ WebSocket Gateway Initialized');
  }

  /**
   * Логирует подключение нового клиента и его уникальный ID.
   */
  handleConnection(client: Socket) {
    this.logger.log(`👤 Client connected: ${client.id}`);
  }

  /**
   * Логирует отключение клиента для мониторинга активных сессий.
   */
  handleDisconnect(client: Socket) {
    this.logger.log(`🔌 Client disconnected: ${client.id}`);
  }
}
