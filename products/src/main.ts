import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('/api');

  const prismaService = app.get(PrismaService);

  // Включаем обработчик завершения работы
  prismaService.enableShutdownHook(app);

  // Использование порта или по умолчанию
  const port = process.env.port || 3000;
  await app.listen(port);
}
bootstrap()
  .then(() => console.log('Application started successfully'))
  .catch((error) => {
    console.log('Application failed to started', error);
    process.exit(1);
  });
