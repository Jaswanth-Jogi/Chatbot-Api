import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Prompts, PromptsSchema } from '../schemas/prompts.schema';
import { PromptsService } from './prompts.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Prompts.name, schema: PromptsSchema }]),
  ],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}

