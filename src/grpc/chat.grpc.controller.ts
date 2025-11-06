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
  }) {
    return this.chatGrpcService.sendMessage(data);
  }

  @GrpcMethod('ChatService', 'GetChatHistory')
  async getChatHistory() {
    return this.chatGrpcService.getChatHistory();
  }
}

