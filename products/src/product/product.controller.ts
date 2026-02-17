/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { RateLimit, RateLimitGuard } from '../redis/rate-limit.guard';
//
@Controller('products')
@UseGuards(RateLimitGuard) // Включаем защиту для всего контроллера
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   *
   *Защита самого тяжелого метода getAll от парсинга и DDoS.
   */
  @Get()
  @RateLimit({ windowMs: 60000, maxRequests: 50 }) // Лимит для списка
  async getAll() {
    return this.productService.getAll();
  }

  @Get('search')
  async search(
    @Query('q') query: string, // поиск оп запросу
    @Query('page') page?: number, // будет одна страница 1
    @Query('limit') limit?: number, // лимит допустим в 10
  ) {
    return await this.productService.search(query, page, limit);
  }

  @Get('popular')
  async getPopular(@Query('limit') limit?: number) {
    return await this.productService.getPopularProducts(limit);
  }

  @Get('category/:categoryId')
  async getByCategory(@Param('categoryId') categoryId: string) {
    return this.productService.getByCategory(categoryId);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.productService.byId(id);
  }

  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.productService.bySlug(slug);
  }

  @Post()
  @RateLimit({ windowMs: 60000, maxRequests: 5 }) // Жесткий лимит для создания
  async create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.productService.delete(id);
  }

  @Patch(':id/stock')
  async updateStock(
    @Param('id') id: string,
    @Body('quantity') quantity: number,
  ) {
    return this.productService.updateStock(id, quantity);
  }

  @Get(':id/stock/check')
  async checkStock(
    @Param('id') id: string,
    @Query('quantity') quantity?: number,
  ) {
    return this.productService.checkStock(id, quantity || 1);
  }
}
