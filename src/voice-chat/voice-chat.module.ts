import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceChat, VoiceChatSchema } from '../schemas/voice-chat.schema';
import { VoiceChatService } from './voice-chat.service';
// Old single-channel gateway - DISABLED, using separate input/output channels instead
// import { VoiceChatGateway } from './voice-chat.gateway';
import { VoiceChatInputGateway } from './voice-chat-input.gateway';
import { VoiceChatOutputGateway } from './voice-chat-output.gateway';
import { GeminiLiveService } from './gemini-live.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VoiceChat.name, schema: VoiceChatSchema },
    ]),
  ],
  providers: [
    VoiceChatService, 
    // VoiceChatGateway, // DISABLED - using separate input/output channels
    VoiceChatInputGateway, 
    VoiceChatOutputGateway, 
    GeminiLiveService
  ],
  exports: [VoiceChatService, GeminiLiveService],
})
export class VoiceChatModule {}

