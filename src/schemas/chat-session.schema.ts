import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ChatSessionDocument = ChatSession & Document;

@Schema({ timestamps: true, collection: 'chatsessions' })
export class ChatSession {
  @Prop({ required: false })
  title?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Children',
    required: true,
    index: true,
  })
  childId: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  @Prop({ required: false })
  resumptionToken?: string;

  @Prop({ type: Date, required: false })
  resumptionTokenExpiration?: Date;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);

