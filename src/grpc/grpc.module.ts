import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { VoiceChatModule } from '../voice-chat/voice-chat.module';
import { ChatGrpcService } from './chat.grpc.service';
import { ChatGrpcController } from './chat.grpc.controller';
import { VoiceChatGrpcService } from './voice-chat.grpc.service';
import { VoiceChatGrpcController } from './voice-chat.grpc.controller';

@Module({
  imports: [ChatModule, VoiceChatModule],
  controllers: [ChatGrpcController, VoiceChatGrpcController],
  providers: [ChatGrpcService, VoiceChatGrpcService],
  exports: [ChatGrpcService, VoiceChatGrpcService],
})
export class GrpcModule {}

