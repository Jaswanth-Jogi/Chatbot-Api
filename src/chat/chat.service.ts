import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument } from '../schemas/chat.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { ChatSessionService } from './chat-session.service';
import { PromptsService } from '../prompts/prompts.service';

@Injectable()
export class ChatService {
  private genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
    private configService: ConfigService,
    private readonly chatSessionService: ChatSessionService,
    private readonly promptsService: PromptsService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async sendMessage(
    message: string,
    history: Array<{ role: string; content: string }>,
    chatSessionId?: string,
    childId?: string,
  ): Promise<string> {
    try {
      // Fetch system instruction with child data from database
      const systemInstructionText = childId
        ? await this.promptsService.buildSystemInstructionWithChildData(childId)
        : await this.promptsService.getPromptByTitle('SystemInstruction');
      if (!systemInstructionText) {
        this.logger.warn('System instruction not found in database, proceeding without it');
      }

      // Get model with system instruction configured
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        ...(systemInstructionText && { systemInstruction: systemInstructionText }),
      });

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

      // Convert chatSessionId string to ObjectId if provided
      const sessionObjectId = chatSessionId ? new Types.ObjectId(chatSessionId) : undefined;

      // If this is the first message in a session, update the session title
      if (sessionObjectId) {
        // Check if this is the first message (no previous chats for this session)
        const existingChats = await this.chatModel.countDocuments({ chatSessionId: sessionObjectId });
        if (existingChats === 0) {
          // First message - set title from user message
          await this.chatSessionService.updateSessionTitle(sessionObjectId.toString(), message);
        }
        // Update session timestamp
        await this.chatSessionService.updateSessionTimestamp(sessionObjectId.toString());
      }

      // Save text chat turn: user input with model response in the same document
      await this.chatModel.create({
        chatSessionId: sessionObjectId,
        role: 'user',
        content: message,
        modelResponse: responseText,
        timestamp: new Date(),
        type: 'text',
      });

      return responseText;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getChatHistory(chatSessionId?: string): Promise<Array<{ role: string; content: string; timestamp: Date }>> {
    // Enforce per-session history only
    if (!chatSessionId) {
      return [];
    }

    const query: any = { chatSessionId: new Types.ObjectId(chatSessionId) };

    const chats = await this.chatModel
      .find(query)
      .sort({ timestamp: 1 })
      .lean();

    // Expand documents: if a document has modelResponse, return both user and model messages
    const messages: Array<{ role: string; content: string; timestamp: Date }> = [];
    
    for (const chat of chats) {
      // Add user message
      messages.push({
        role: chat.role,
        content: chat.content,
        timestamp: chat.timestamp,
      });
      
      // If document has modelResponse, add model message too
      if (chat.modelResponse) {
        messages.push({
          role: 'model',
          content: chat.modelResponse,
          timestamp: chat.timestamp, // Use same timestamp or could add a small offset
        });
      }
    }

    return messages;
  }

  async saveVoiceChatTurn(
    userInput: string,
    modelResponse: string,
    chatSessionId?: string,
  ): Promise<void> {
    try {
      // Convert chatSessionId string to ObjectId if provided
      const sessionObjectId = chatSessionId ? new Types.ObjectId(chatSessionId) : undefined;

      // If this is the first message in a session, update the session title
      if (sessionObjectId) {
        // Check if this is the first message (no previous chats for this session)
        const existingChats = await this.chatModel.countDocuments({ chatSessionId: sessionObjectId });
        if (existingChats === 0) {
          // First message - set title from user input
          await this.chatSessionService.updateSessionTitle(sessionObjectId.toString(), userInput);
        }
        // Update session timestamp
        await this.chatSessionService.updateSessionTimestamp(sessionObjectId.toString());
      }

      // Save voice chat turn: user input with model response in the same document
      await this.chatModel.create({
        chatSessionId: sessionObjectId,
        role: 'user',
        content: userInput,
        modelResponse: modelResponse,
        timestamp: new Date(),
        type: 'voice',
      });
      this.logger.debug(`Saved voice chat turn: user="${userInput.substring(0, 50)}...", model="${modelResponse.substring(0, 50)}..."`);
    } catch (error) {
      this.logger.error('Failed to save voice chat turn', error);
      throw error;
    }
  }
}

