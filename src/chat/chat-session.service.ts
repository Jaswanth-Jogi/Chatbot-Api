import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  async createSession(childId: string, title?: string): Promise<ChatSessionDocument> {
    const session = await this.chatSessionModel.create({
      childId: new Types.ObjectId(childId),
      title: title || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.logger.debug(`Created chat session: ${session._id}, childId: ${childId}, title: ${title || 'untitled'}`);
    return session;
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.chatSessionModel.findByIdAndUpdate(sessionId, {
      title,
      updatedAt: new Date(),
    });
    this.logger.debug(`Updated session ${sessionId} title to: ${title}`);
  }

  async getAllSessions(childId: string): Promise<ChatSessionDocument[]> {
    // Sort by updatedAt descending (most recent first)
    const sessions = await this.chatSessionModel
      .find({ childId: new Types.ObjectId(childId) })
      .sort({ updatedAt: -1 })
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
    // Convert sessionId string to ObjectId for query
    const sessionObjectId = new Types.ObjectId(sessionId);
    const messages = await this.chatModel
      .find({ chatSessionId: sessionObjectId })
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

  async updateResumptionToken(sessionId: string, token: string | null, expiration: Date | null): Promise<void> {
    const updateData: any = {
      updatedAt: new Date(),
    };
    if (token) {
      updateData.resumptionToken = token;
    } else {
      updateData.$unset = { resumptionToken: '', resumptionTokenExpiration: '' };
    }
    if (expiration) {
      updateData.resumptionTokenExpiration = expiration;
    }
    
    await this.chatSessionModel.findByIdAndUpdate(sessionId, updateData);
    if (token) {
      this.logger.debug(`Updated resumption token for session ${sessionId}, expires at ${expiration?.toISOString()}`);
    } else {
      this.logger.debug(`Cleared resumption token for session ${sessionId}`);
    }
  }

  async getSession(sessionId: string): Promise<ChatSessionDocument | null> {
    return await this.chatSessionModel.findById(sessionId).exec();
  }
}

