/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Field, ID, ObjectType, Float, Int } from '@nestjs/graphql';

@ObjectType({ description: 'Модель продукта' })
export class Product {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float)
  price: number;

  // @Field()
  // slug: string;

  // @Field(() => Int)
  // stockCount: number;

  @Field()
  categoryId: string;

  @Field()
  createdAt: Date;
}
