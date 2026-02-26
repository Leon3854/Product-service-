import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { ProductModule } from './product/product.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * Корневой модуль приложения (Root Module).
 * Соединяет все независимые функциональные модули и настраивает
 * глобальные инфраструктурные слои (Config, GraphQL).
 */
@Module({
  imports: [
    // 1. Загрузка конфигурации из .env (Глобально)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
    }),

    // 2. Инициализация движка GraphQL (Apollo)
    // Без этого блока декораторы @Query и @Mutation не будут работать!
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'), // Генерация схемы "на лету"
      playground: true, // Включает песочницу в браузере (localhost:3000/graphql)
    }),

    // 3. Подключение твоего основного модуля
    // Теперь NestJS увидит твой ProductController и ProductResolver
    ProductModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
