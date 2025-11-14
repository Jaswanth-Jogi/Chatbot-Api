import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Prompts, PromptsDocument } from '../schemas/prompts.schema';

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectModel(Prompts.name) private promptsModel: Model<PromptsDocument>,
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
}

