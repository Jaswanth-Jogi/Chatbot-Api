import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { VoiceChatGrpcService } from './voice-chat.grpc.service';

@Controller()
export class VoiceChatGrpcController {
  constructor(private readonly voiceChatGrpcService: VoiceChatGrpcService) {}

  @GrpcMethod('VoiceChatService', 'GetEphemeralToken')
  async getEphemeralToken() {
    return this.voiceChatGrpcService.getEphemeralToken();
  }

  @GrpcMethod('VoiceChatService', 'SaveVoiceTurn')
  async saveVoiceTurn(data: { user: string; model: string }) {
    return this.voiceChatGrpcService.saveVoiceTurn(data);
  }
}

