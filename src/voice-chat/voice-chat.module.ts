import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceChat, VoiceChatSchema } from '../schemas/voice-chat.schema';
import { VoiceChatService } from './voice-chat.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VoiceChat.name, schema: VoiceChatSchema },
    ]),
  ],
  providers: [VoiceChatService],
  exports: [VoiceChatService],
})
export class VoiceChatModule {}

