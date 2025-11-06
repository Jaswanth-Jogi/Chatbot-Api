import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VoiceChatDocument = VoiceChat & Document;

@Schema({ timestamps: true, collection: 'voice_chats' })
export class VoiceChat {
  @Prop({ required: true })
  user: string;

  @Prop({ required: true })
  model: string;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;
}

export const VoiceChatSchema = SchemaFactory.createForClass(VoiceChat);

