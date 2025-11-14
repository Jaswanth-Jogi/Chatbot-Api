import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ChatGrpcService } from './chat.grpc.service';

@Controller()
export class ChatGrpcController {
  constructor(private readonly chatGrpcService: ChatGrpcService) {}

  @GrpcMethod('ChatService', 'SendMessage')
  async sendMessage(data: {
    message: string;
    history: Array<{ role: string; content: string }>;
    chatSessionId?: string;
    childId?: string;
  }) {
    return this.chatGrpcService.sendMessage(data);
  }

  @GrpcMethod('ChatService', 'GetChatHistory')
  async getChatHistory() {
    return this.chatGrpcService.getChatHistory();
  }

  @GrpcMethod('ChatService', 'CreateChatSession')
  async createChatSession(data: { title?: string; childId?: string }) {
    if (!data.childId) {
      throw new Error('childId is required');
    }
    return this.chatGrpcService.createChatSession(data.childId, data.title);
  }

  @GrpcMethod('ChatService', 'GetChatSessions')
  async getChatSessions(data: { childId?: string }) {
    if (!data.childId) {
      throw new Error('childId is required');
    }
    return this.chatGrpcService.getChatSessions(data.childId);
  }

  @GrpcMethod('ChatService', 'GetChatSessionWithMessages')
  async getChatSessionWithMessages(data: { sessionId: string }) {
    return this.chatGrpcService.getChatSessionWithMessages(data.sessionId);
  }
}

