import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Chat, ChatSchema } from '../schemas/chat.schema';
import { ChatSession, ChatSessionSchema } from '../schemas/chat-session.schema';
import { ChatService } from './chat.service';
import { ChatSessionService } from './chat-session.service';
import { PromptsModule } from '../prompts/prompts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Chat.name, schema: ChatSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
    ]),
    PromptsModule, // Import PromptsModule to access PromptsService
  ],
  providers: [ChatService, ChatSessionService],
  exports: [ChatService, ChatSessionService],
})
export class ChatModule {}

