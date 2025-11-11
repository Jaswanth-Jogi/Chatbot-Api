import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatSession, ChatSessionDocument } from '../schemas/chat-session.schema';
import { Chat, ChatDocument } from '../schemas/chat.schema';

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(
    @InjectModel(ChatSession.name)
    private readonly chatSessionModel: Model<ChatSessionDocument>,
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
  ) {}

  async createSession(title?: string): Promise<ChatSessionDocument> {
    const session = await this.chatSessionModel.create({
      title: title || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.logger.debug(`Created chat session: ${session._id}, title: ${title || 'untitled'}`);
    return session;
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.chatSessionModel.findByIdAndUpdate(sessionId, {
      title,
      updatedAt: new Date(),
    });
    this.logger.debug(`Updated session ${sessionId} title to: ${title}`);
  }

  async getAllSessions(): Promise<ChatSessionDocument[]> {
    // Sort by updatedAt ascending (oldest first)
    const sessions = await this.chatSessionModel
      .find()
      .sort({ updatedAt: 1 })
      .exec();
    return sessions;
  }

  async getSessionWithMessages(sessionId: string): Promise<{
    session: ChatSessionDocument;
    messages: ChatDocument[];
  }> {
    const session = await this.chatSessionModel.findById(sessionId).exec();
    if (!session) {
      throw new Error(`Chat session ${sessionId} not found`);
    }

    // Fetch all chats for this session, sorted by timestamp
    const messages = await this.chatModel
      .find({ chatSessionId: sessionId })
      .sort({ timestamp: 1 })
      .exec();

    return {
      session,
      messages,
    };
  }

  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await this.chatSessionModel.findByIdAndUpdate(sessionId, {
      updatedAt: new Date(),
    });
  }
}

