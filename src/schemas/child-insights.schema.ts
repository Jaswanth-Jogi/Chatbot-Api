import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ChildInsightsDocument = ChildInsights & Document;

@Schema({ timestamps: true, collection: 'child_insights' })
export class ChildInsights {
  @Prop({
    type: MongooseSchema.Types.Mixed, // Allow both string and ObjectId
    required: true,
    index: true,
  })
  childId: string | Types.ObjectId;

  @Prop({ type: String, required: true })
  insight_type: string;

  @Prop({ type: String, required: true })
  insight: string;

  @Prop({ type: String, required: false })
  SupportingData?: string;

  @Prop({ type: String, required: false })
  category?: string;

  @Prop({ type: String, required: false })
  implication?: string;

  @Prop({ type: Date, required: false })
  created_at?: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ChildInsightsSchema = SchemaFactory.createForClass(ChildInsights);

ChildInsightsSchema.index({ childId: 1, createdAt: -1 }, { name: 'idx_childId_createdAt' });

