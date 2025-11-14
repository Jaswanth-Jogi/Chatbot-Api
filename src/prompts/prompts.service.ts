import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Prompts, PromptsDocument } from '../schemas/prompts.schema';
import { Children, ChildrenDocument } from '../schemas/children.schema';
import { ChildInsights, ChildInsightsDocument } from '../schemas/child-insights.schema';

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectModel(Prompts.name) private promptsModel: Model<PromptsDocument>,
    @InjectModel(Children.name) private childrenModel: Model<ChildrenDocument>,
    @InjectModel(ChildInsights.name) private childInsightsModel: Model<ChildInsightsDocument>,
  ) {}

  async getPromptByTitle(title: string): Promise<string | null> {
    try {
      const prompt = await this.promptsModel.findOne({ Title: title }).exec();
      if (!prompt) {
        this.logger.warn(`Prompt not found: title=${title}`);
        return null;
      }
      return prompt.content;
    } catch (error) {
      this.logger.error(`Error fetching prompt: title=${title}`, error);
      return null;
    }
  }

  async buildSystemInstructionWithChildData(childId: string): Promise<string | null> {
    try {
      // Fetch system instruction
      const systemInstruction = await this.getPromptByTitle('SystemInstruction');
      if (!systemInstruction) {
        this.logger.warn('System instruction not found in database');
        return null;
      }

      // Fetch child data
      const child = await this.childrenModel.findById(new Types.ObjectId(childId)).exec();
      if (!child) {
        this.logger.warn(`Child not found: childId=${childId}`);
        return systemInstruction; // Return system instruction without child data
      }

      // Fetch latest 6 insights - childId is stored as string in child_insights collection
      // Query as string first (as stored in DB)
      let insights = await this.childInsightsModel
        .find({ childId: childId }) // Query as string (as stored in DB)
        .sort({ createdAt: -1 })
        .limit(6)
        .exec();
      
      this.logger.debug(`Found ${insights.length} insights for childId: ${childId} (queried as string)`);
      
      // If no results and childId is a valid ObjectId, also try as ObjectId
      if (insights.length === 0 && Types.ObjectId.isValid(childId)) {
        this.logger.debug(`No insights found as string, trying as ObjectId for childId: ${childId}`);
        insights = await this.childInsightsModel
          .find({ childId: new Types.ObjectId(childId) })
          .sort({ createdAt: -1 })
          .limit(6)
          .exec();
        this.logger.debug(`Found ${insights.length} insights when queried as ObjectId`);
      }

      // Build child data string
      let childData = `\n\nChild name: ${child.name}\nAge: ${child.age}\nGrade: ${child.grade}`;

      if (insights.length > 0) {
        childData += '\n\n# Insight Data';
        insights.forEach((insight) => {
          childData += `\n\nInsight type: ${insight.insight_type}`;
          childData += `\nInsight: ${insight.insight}`;
          if (insight.SupportingData) {
            childData += `\nSupporting data: ${insight.SupportingData}`;
          }
        });
      }

      // Log the built childData for debugging
      console.log('='.repeat(80));
      console.log(`[CHILD DATA] Built for childId: ${childId}`);
      console.log('='.repeat(80));
      console.log(childData);
      console.log('='.repeat(80));

      // Combine system instruction with child data
      return systemInstruction + childData;
    } catch (error) {
      this.logger.error(`Error building system instruction with child data: childId=${childId}`, error);
      // Fallback to system instruction only
      return await this.getPromptByTitle('SystemInstruction');
    }
  }
}

