import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatDocument = Chat & Document;

@Schema({ timestamps: true, collection: 'chats' })
export class Chat {
  @Prop({ required: true, enum: ['user', 'model'] })
  role: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;

  @Prop({ enum: ['text', 'voice'], default: 'text' })
  type: string;

  // For voice chat: store the complete conversation turn
  // When type is 'voice' and role is 'user', this contains the model's response for this turn
  @Prop({ required: false })
  modelResponse?: string;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);

