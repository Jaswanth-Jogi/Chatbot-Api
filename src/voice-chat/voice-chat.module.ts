import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceChat, VoiceChatSchema } from '../schemas/voice-chat.schema';
import { VoiceChatService } from './voice-chat.service';
import { VoiceChatGateway } from './voice-chat.gateway';
import { GeminiLiveService } from './gemini-live.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VoiceChat.name, schema: VoiceChatSchema },
    ]),
  ],
  providers: [VoiceChatService, VoiceChatGateway, GeminiLiveService],
  exports: [VoiceChatService, GeminiLiveService],
})
export class VoiceChatModule {}

