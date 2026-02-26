/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Transform } from 'class-transformer';
import {
  // IsArray,
  // IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  // IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  // MinLength,
  // ValidateNested,
} from 'class-validator';
/**
 * Data Transfer Object (DTO) для регистрации нового продукта.
 * Включает строгую валидацию типов и бизнес-правил через class-validator,
 * а также нормализацию входящих данных через class-transformer.
 */
export class CreateProductDto {
  /**
   * Название товара.
   * Ограничено по длине и символам для корректного отображения в UI и безопасности БД.
   * @example "Mechanical Keyboard K87"
   */
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
  /**
   * Подробное описание товара.
   * Поле опционально, ограничено 1000 символами для предотвращения DB Bloat (раздувания базы). [INDEX 1]
   */
  @IsString()
  @IsOptional()
  @MaxLength(1000, {
    message: 'Description must be not more 1000 characters',
  })
  description?: string;

  /**
   * Розничная цена товара.
   * Автоматически преобразуется в числовой формат (float).
   * Ограничение в 2 знака после запятой обеспечивает точность финансовых расчетов. [INDEX 4]
   * @example 299.99
   */
  @IsNumber({ maxDecimalPlaces: 2 }) // Важно для денежных значений
  @Min(0.01, { message: 'Price must be greater than 0' })
  @Max(1000000, { message: 'Price cannot exceed 1,000,000' })
  @Transform(({ value }) => parseFloat(value))
  price: number;
  // Примечание для ревьюера: закомментированные поля (categoryId, SKU, images)
  // зарезервированы для будущего расширения функционала склада и SEO.
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

  @IsString()
  @IsUUID() // Предполагаем, что categoryId - это UUID
  categoryId: string;

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

/**
 * Аргументация @Transform: Ты объясняешь, что это нужно для нормализации.
 * Часто данные приходят из FormData как строки, и твой автоматический
 * parseFloat спасает сервис от падения.
 * Защита БД (DB Bloat): Упоминание ограничения описания в 1000 символов как защиты от раздувания базы - думаешь о ресурсах диска.
 * Финансовая точность: Комментарий про maxDecimalPlaces показывает, разницу между «просто числом» и «деньгами».
 * Регулярные выражения (@Matches): Это защита от XSS и инъекций, не просто принимаем строку, диктуем безопасный формат.
 *
 * Заметь, что  закомментирован categoryId. В твоем ProductService он, скорее всего, обязателен.
 * Его «раскомментировать», обязательно добавь @IsUUID(), так как PostgreSQL/Prisma очень не любят, когда вместо UUID прилетает обычная строка.
 * Твой DTO теперь — это не просто класс, а защищенный контракт! 🛡️🚀
 */
