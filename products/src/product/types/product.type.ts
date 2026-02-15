// src/product/types/product.types.ts
import { Prisma } from '@prisma/client';

// Базавый выбор для продута
export const productSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
} as const satisfies Prisma.ProductSelect;

export const ProductPreviewSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
} as const satisfies Prisma.ProductSelect;

// типы на основе select
export type Product = Prisma.ProductGetPayload<{
  select: typeof productSelect;
}>;

export type ProductPreview = Prisma.ProductGetPayload<{
  select: typeof ProductPreviewSelect;
}>;

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  links?: {
    self: string;
    first?: string;
    last?: string;
    next?: string;
    prev?: string;
  };
}

// Типы для DTO (обновленные)
export type CreateProductInput = Omit<
  Product,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateProductInput = Partial<CreateProductInput>;

// Response типы для разных сценариев
export type ProductResponse = Product;
export type ProductsResponse = PaginatedResponse<ProductPreview>;
export type ProductMinimal = Pick<
  Product,
  'id' | 'name' | 'description' | 'price'
>;
export type ProductCatalog = Omit<
  Product,
  'userId' | 'createdAt' | 'updatedAt'
>;
