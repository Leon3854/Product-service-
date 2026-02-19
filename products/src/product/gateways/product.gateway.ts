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
  notifyProductCreated(product: any) {
    this.server.emit('product_created', product);
    this.logger.log(`📢 Broadcast: Product ${product.id} sent to clients`);
  }

  notifyStockUpdated(data: any) {
    this.server.emit('stock_updated', data);
  }

  // Служебные хуки
  afterInit(server: Server) {
    this.logger.log('✅ WebSocket Gateway Initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`👤 Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`🔌 Client disconnected: ${client.id}`);
  }
}
