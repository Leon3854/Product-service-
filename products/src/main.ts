import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Глобальный префикс - отлично для микросервиса
  app.setGlobalPrefix('/api');

  // 2. CORS - критично, если фронтенд на другом порту (5173)
  app.enableCors({
    origin: process.env.CORS_ORIGEN || 'http://localhost:5173',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 3. Prisma Shutdown Hook (в новых версиях Prisma может не требоваться, но лишним не будет)
  const prismaService = app.get(PrismaService);
  // prismaService.enableShutdownHook(app);
  // Проверь, реализован ли этот метод в твоем PrismaService

  // Включаем обработчик завершения работы
  prismaService.enableShutdownHook(app);

  // 4. ПРАВИЛЬНЫЙ ЗАПУСК НА ПОРТУ И ХОСТЕ
  const PORT = process.env.PORT || 3000;
  // Важно: '0.0.0.0' идет вторым аргументом в listen, а не в переменную порта!
  await app.listen(PORT, '0.0.0.0');

  console.log(`🚀 Application is running on: http://localhost:${PORT}/api`);
}
bootstrap()
  .then(() => console.log('Application started successfully'))
  .catch((error) => {
    console.log('Application failed to started', error);
    process.exit(1);
  });
