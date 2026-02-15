// product.graphql-types.ts
import { Field, ID, ObjectType, Float, Int, Directive } from '@nestjs/graphql';

@ObjectType()
@Directive('@key(fields: "id")')
export class Product {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float)
  price: number;

  @Field()
  sku: string;

  @Field(() => [String], { nullable: true })
  images?: string[];

  @Field(() => ID)
  categoryId: string;

  @Field(() => ID, { nullable: true })
  userId?: string;

  @Field(() => Boolean, { nullable: true })
  inStock?: boolean;

  @Field(() => Int, { nullable: true })
  stockCount?: number;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field(() => Float, { nullable: true })
  weight?: number;

  @Field(() => Boolean, { nullable: true })
  isActive?: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Поле для федерации - резолвится из другого сервиса
  @Field(() => Category, { nullable: true })
  category?: Category;
}

@ObjectType()
@Directive('@key(fields: "id")')
export class Category {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;
}

// Входные типы для GraphQL мутаций
@InputType()
export class CreateProductGraphQLInput {
  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float)
  price: number;

  @Field()
  sku: string;

  @Field(() => [String], { nullable: true })
  images?: string[];

  @Field(() => ID)
  categoryId: string;

  @Field(() => ID, { nullable: true })
  userId?: string;

  @Field(() => Boolean, { nullable: true })
  inStock?: boolean;

  @Field(() => Int, { nullable: true })
  stockCount?: number;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field(() => Float, { nullable: true })
  weight?: number;

  @Field(() => Boolean, { nullable: true })
  isActive?: boolean;
}

@InputType()
export class UpdateProductGraphQLInput extends PartialType(
  CreateProductGraphQLInput,
) {
  @Field(() => ID)
  id: string;
}

// Типы для пагинации
@ObjectType()
export class ProductConnection {
  @Field(() => [Product])
  nodes: Product[];

  @Field(() => Int)
  totalCount: number;

  @Field()
  hasNextPage: boolean;

  @Field()
  hasPreviousPage: boolean;
}
