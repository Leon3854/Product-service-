/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { PartialType } from '@nestjs/mapped-types';

// DTO для обновления продукта (все поля опциональные)
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsString()
  name?: string | undefined;

  @IsString()
  @IsOptional()
  description?: string | undefined;

  @IsNumber()
  @IsOptional()
  price?: number | undefined;
}
