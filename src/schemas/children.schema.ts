import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChildrenDocument = Children & Document;

@Schema({ timestamps: true })
export class Children {
  @Prop({ type: String, required: true })
  ownerUserId: string;

  @Prop({ type: String, trim: true, required: true })
  name: string;

  @Prop({ type: Date, required: true })
  dateOfBirth: Date;

  @Prop({ type: Number, required: true, min: 0, max: 18 })
  age: number;

  @Prop({ type: String, trim: true, required: true })
  grade: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ChildrenSchema = SchemaFactory.createForClass(Children);

ChildrenSchema.index({ ownerUserId: 1 }, { name: 'idx_ownerUserId' });
ChildrenSchema.index({ ownerUserId: 1, name: 1 }, { name: 'idx_owner_name' });
ChildrenSchema.index({ dateOfBirth: 1 }, { name: 'idx_dateOfBirth' });
ChildrenSchema.index({ createdAt: -1 }, { name: 'idx_createdAt_desc' });
ChildrenSchema.index({ age: 1 }, { name: 'idx_age' });

