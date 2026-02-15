/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Transform } from 'class-transformer';
import {
  // IsArray,
  // IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  // IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  // MinLength,
  // ValidateNested,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Length(3, 50, { message: 'Name must be between 3 and 50 characters' })
  @Matches(/^[a-zA-Z0-9\s\-_]*$/, {
    message:
      'Name can only contain letters, numbers, spaces, hyphens and underscores',
  })
  name: string;

  // @IsString()
  // @Length(3, 50, { message: 'Name must be between 3 and 50 characters' })
  // @Matches(/^[a-z0-9\s\-_]*$/, {
  //   // Более строгое правило для slug
  //   message:
  //     'Slug can only contain letters, numbers, spaces, hyphens and underscores',
  // })
  // slug: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, {
    message: 'Description must be not more 1000 characters',
  })
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) // Важно для денежных значений
  @Min(0.01, { message: 'Price must be greater than 0' })
  @Max(1000000, { message: 'Price cannot exceed 1,000,000' })
  @Transform(({ value }) => parseFloat(value))
  price: number;

  // @IsString()
  // @Length(5, 50, { message: 'SKU must be between 5 and 50 characters' })
  // @Matches(/^[A-Z0-9\-]+$/, {
  //   message: 'SKU can only contain uppercase letters, numbers and hyphens',
  // })
  // sku: string;

  // @IsString()
  // @IsString({ each: true })
  // @IsOptional()
  // @Transform(({ value }) => {
  //   // Если пришла строка с JSON, парсим
  //   if (typeof value === 'string') {
  //     try {
  //       return JSON.parse(value);
  //     } catch {
  //       return value.split(',').map((s) => s.trim());
  //     }
  //   }
  //   return value;
  // })
  // images?: string[];

  // @IsString()
  // @IsUUID() // Предполагаем, что categoryId - это UUID
  // categoryId: string;

  // @IsString()
  // @IsUUID()
  // @IsOptional()
  // userId?: string;

  // @IsBoolean()
  // @IsOptional()
  // @Transform(({ value }) => {
  //   if (typeof value === 'string') {
  //     return value === 'true';
  //   }
  //   return value;
  // })
  // inStock?: boolean;

  // @IsNumber()
  // @IsOptional()
  // @Min(0)
  // @Transform(({ value }) => parseInt(value, 10))
  // stockCount?: number;

  // Дополнительные поля, которые могут быть полезны
  // @IsArray()
  // @IsString({ each: true })
  // @IsOptional()
  // tags?: string[];

  // @IsNumber()
  // @IsOptional()
  // @Min(0)
  // weight?: number;

  // @IsBoolean()
  // @IsOptional()
  // isActive?: boolean;
}
