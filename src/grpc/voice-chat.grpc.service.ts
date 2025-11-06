import { Injectable } from '@nestjs/common';
import { VoiceChatService } from '../voice-chat/voice-chat.service';

@Injectable()
export class VoiceChatGrpcService {
  constructor(private readonly voiceChatService: VoiceChatService) {}

  async getEphemeralToken() {
    const token = await this.voiceChatService.getEphemeralToken();
    return { token };
  }

  async saveVoiceTurn(data: { user: string; model: string }) {
    const voiceTurn = await this.voiceChatService.saveVoiceTurn(
      data.user,
      data.model,
    );

    // Access _id from the document
    const id = (voiceTurn as any)._id?.toString() || '';

    return {
      id,
      user: voiceTurn.user,
      model: voiceTurn.model,
      timestamp: voiceTurn.timestamp.toISOString(),
    };
  }
}

