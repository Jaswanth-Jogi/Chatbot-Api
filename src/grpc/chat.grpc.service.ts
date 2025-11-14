import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { ChatSessionService } from '../chat/chat-session.service';
import { Types } from 'mongoose';

@Injectable()
export class ChatGrpcService {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatSessionService: ChatSessionService,
  ) {}

  async sendMessage(data: {
    message: string;
    history: Array<{ role: string; content: string }>;
    chatSessionId?: string;
  }) {
    try {
      const response = await this.chatService.sendMessage(
        data.message,
        data.history || [],
        data.chatSessionId,
      );

      return {
        role: 'model',
        content: response,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error in chat.grpc.service.sendMessage:', error);
      throw error;
    }
  }

  async getChatHistory() {
    const history = await this.chatService.getChatHistory();
    return {
      messages: history.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
      })),
    };
  }

  async createChatSession(childId: string, title?: string) {
    try {
      const session = await this.chatSessionService.createSession(childId, title);
      return {
        id: (session._id as Types.ObjectId).toString(),
        title: session.title || '',
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      };
    } catch (error) {
      console.error('Error in chat.grpc.service.createChatSession:', error);
      throw error;
    }
  }

  async getChatSessions(childId: string) {
    try {
      const sessions = await this.chatSessionService.getAllSessions(childId);
      return {
        sessions: sessions.map((session) => ({
          id: (session._id as Types.ObjectId).toString(),
          title: session.title || '',
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      console.error('Error in chat.grpc.service.getChatSessions:', error);
      throw error;
    }
  }

  async getChatSessionWithMessages(sessionId: string) {
    try {
      const { session, messages } = await this.chatSessionService.getSessionWithMessages(sessionId);
      
      // Expand messages: if a document has modelResponse, return both user and model messages
      const expandedMessages: Array<{ role: string; content: string; timestamp: string }> = [];
      
      for (const chat of messages) {
        // Add user message
        expandedMessages.push({
          role: chat.role,
          content: chat.content,
          timestamp: chat.timestamp.toISOString(),
        });
        
        // If document has modelResponse, add model message too
        if (chat.modelResponse) {
          expandedMessages.push({
            role: 'model',
            content: chat.modelResponse,
            timestamp: chat.timestamp.toISOString(),
          });
        }
      }

      return {
        session: {
          id: (session._id as Types.ObjectId).toString(),
          title: session.title || '',
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        },
        messages: expandedMessages,
      };
    } catch (error) {
      console.error('Error in chat.grpc.service.getChatSessionWithMessages:', error);
      throw error;
    }
  }
}

