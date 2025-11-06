import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';

@Injectable()
export class ChatGrpcService {
  constructor(private readonly chatService: ChatService) {}

  async sendMessage(data: {
    message: string;
    history: Array<{ role: string; content: string }>;
  }) {
    try {
      const response = await this.chatService.sendMessage(
        data.message,
        data.history || [],
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
}

