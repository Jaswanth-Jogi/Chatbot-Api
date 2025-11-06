import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Chat, ChatDocument } from '../schemas/chat.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChatService {
  private genAI: GoogleGenerativeAI;

  constructor(
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async sendMessage(message: string, history: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      // Convert history to Gemini format
      const geminiHistory = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

      // Add current message
      const chat = model.startChat({
        history: geminiHistory,
      });

      const result = await chat.sendMessage(message);
      const response = await result.response;
      const responseText = response.text();

      // Save user message
      await this.chatModel.create({
        role: 'user',
        content: message,
        timestamp: new Date(),
      });

      // Save model response
      await this.chatModel.create({
        role: 'model',
        content: responseText,
        timestamp: new Date(),
      });

      return responseText;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getChatHistory(): Promise<Array<{ role: string; content: string; timestamp: Date }>> {
    const chats = await this.chatModel
      .find()
      .sort({ timestamp: 1 })
      .lean();

    return chats.map((chat) => ({
      role: chat.role,
      content: chat.content,
      timestamp: chat.timestamp,
    }));
  }
}

