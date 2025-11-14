import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PromptsDocument = Prompts & Document;

@Schema({ timestamps: true })
export class Prompts {
  @Prop({ required: true, enum: ['Tone', 'core', 'Bot'] })
  type: string;

  @Prop({ required: true })
  Title: string;

  @Prop({ required: true })
  content: string;
}

export const PromptsSchema = SchemaFactory.createForClass(Prompts);

