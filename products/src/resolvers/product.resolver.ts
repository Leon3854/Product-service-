/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { ProductService } from '../product/product.service';
import { Product } from '../product/models/product.model';
import { CreateProductDto } from '../product/dto/create-product.dto'; // Твои существующие DTO
import { UseGuards } from '@nestjs/common';
import { RateLimitGuard, RateLimit } from '../redis/rate-limit.guard';

@Resolver(() => Product)
@UseGuards(RateLimitGuard) // Твоя защита работает и здесь!
export class ProductResolver {
  constructor(private readonly productService: ProductService) {}

  // Получение всех продуктов
  @Query(() => [Product], { name: 'products' })
  @RateLimit({ windowMs: 60000, maxRequests: 50 })
  async getProducts() {
    return this.productService.getAll();
  }

  // Получение по ID (сработает твой Redis кэш внутри сервиса)
  @Query(() => Product, { name: 'product', nullable: true })
  async getProduct(@Args('id', { type: () => String }) id: string) {
    return this.productService.byId(id);
  }

  // Поиск (с пагинацией)
  @Query(() => [Product])
  async searchProducts(
    @Args('q') q: string,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
  ) {
    const result = await this.productService.search(q, page);
    return result.items;
  }

  // Создание (сработает отправка в Kafka внутри сервиса)
  @Mutation(() => Product)
  @RateLimit({ windowMs: 60000, maxRequests: 5 })
  async createProduct(@Args('input') input: CreateProductDto) {
    return this.productService.create(input);
  }
}
