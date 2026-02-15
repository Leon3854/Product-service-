/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  // Matches,
  Max,
  Min,
} from 'class-validator';

// DTO для поиска/фильтрации продуктов
export class FindProductsDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  minPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  maxPrice?: number;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  inStock?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  // @IsString()
  // @IsOptional()
  // sortBy?: string = 'createdAt';

  // @IsString()
  // @IsOptional()
  // @Matches(/^(asc|desc)$/i)
  // sortOrder?: 'asc' | 'desc' = 'desc';
}
