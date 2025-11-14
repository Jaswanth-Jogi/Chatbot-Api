import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Prompts, PromptsSchema } from '../schemas/prompts.schema';
import { Children, ChildrenSchema } from '../schemas/children.schema';
import { ChildInsights, ChildInsightsSchema } from '../schemas/child-insights.schema';
import { PromptsService } from './prompts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Prompts.name, schema: PromptsSchema },
      { name: Children.name, schema: ChildrenSchema },
      { name: ChildInsights.name, schema: ChildInsightsSchema },
    ]),
  ],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}

