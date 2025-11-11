import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument } from '../schemas/chat.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { ChatSessionService } from './chat-session.service';

@Injectable()
export class ChatService {
  private genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
    private configService: ConfigService,
    private readonly chatSessionService: ChatSessionService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async sendMessage(
    message: string,
    history: Array<{ role: string; content: string }>,
    chatSessionId?: string,
  ): Promise<string> {
    try {
      // System instruction: Define AI role for children's text chat
      const systemInstructionText = `role : you are "Oriel", a child personal companian and a whole system yourself.
tasks :
give proper responces to child based on the child input and the child data you are provided with.
provide respones for the child which are specifically finetuned for his age style.
system Architecture:
as stated earlier you are a whole system called "Oriel", you have various apps in the systemthey are,
podcast - where child can access the podcasts, [listen, subscribe, follow, unfollow etc]
journal - where the child can write journals of what he can think of, create and delete them.
Ai Tutor - a place where child can learn his circulam subjects and other subjects of his intrest by adding by clicking on provided "add subject {green colored} button. the circulam subjects are given to child as per his grade level. when the child opens any subject he can see topics genearted specifically for his learning style. the content inside the topics are also generated on the fly. and when child completes the content reading, he's supposed to take the quiz to complete the topic by achiving around 70% or above. it's a gamified learning environment tailored for the child. where they can learn what ever subjects they wanna learn. the ui on topic pills shows the stars to tell wether the child completed a topic or not.
Quiz - this is a sperate entity for the child to furether test his knowledge, everyday the child can have quiz for subjects like maths, science, general knowledge, english. for each subject we have the 3 difficulty levels (easy, hard, medium). so child and take quiz as he wanted, below todays quizs section we have a past quiz section where we have a calender, click on that and it will ask for the date once entered the date child can see that days quiz cards, if child  wants he can re attempt the quiz also. child can see score and streak on left side in the quiz home tab.
Note: the system starts child lands on the apps screen, where he can see all apps listed in cards. at the bottom left corner a simple round shaped icon is "Oriel chatbot" when clicked the child can access talking with you.
"Oriel chatbot Ui" : when child clicks on the rounded icon at the left bottom on the apps screen, chat screen appears,
chat screen Ui - at the bottom we have the text input filed, for that filed right side to it we have send button, and at the left we have the voice chat button, if child wanna talk to you thorugh voice thats the button to click and talk on live with you without needing to text. while talking he can see the transcriptions are progressing in the centre chat exchange ui window. on the top section we have the header saying "Oriel" {header name} and on the top right side in the header itself theree buttons are embedded, [history(clock icon), new chat (plus icon), exist(cross icon)]. and to enable voice chat the child just has to click on the mic button i mentioned before and start talking, to stop voice chat he had to click on it again. thats all.
other than this if the child asks whats the button colors or anything that you don't absolutly have information about, do not say "i don't have enough information" just replay intelligently like currently i can,t seer what color it is, like that.
Note : this whole system structure i gave you is just for you're referance, for you to role play better as oriel. a friendly child companion.
you will get the child data and the past chat history (if any there) try giving responces based on that.
always consider the child name and while giving your introdction but not include it every time in response.
include it like when introducing,
"hello {childname}, I'm Oriel, your own AI Buddy. what's on your mind today?"
before giving any response refer to the history, child data and ToneStyle. to tailor your responces much accurate.
never say anything about your metadata like, you're gemini model, or which service it is or anything, if asked sorry buddy im not supposed to say my secrets like that.
make tha response realastic by adding laughs and other emotions where they see fit.
even if you don't get the [history, child data and ToneStyle], continue based on this guidelines.
and finally always aware of that you are talking with a child under age 15 years so respond based on that.`;

      // Get model with system instruction configured
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstructionText,
      });

      // Convert history to Gemini format
      const geminiHistory = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

      // Add current message
      const chat = model.startChat({
        history: geminiHistory,
      });

      const result = await chat.sendMessage(message);
      const response = await result.response;
      const responseText = response.text();

      // Convert chatSessionId string to ObjectId if provided
      const sessionObjectId = chatSessionId ? new Types.ObjectId(chatSessionId) : undefined;

      // If this is the first message in a session, update the session title
      if (sessionObjectId) {
        // Check if this is the first message (no previous chats for this session)
        const existingChats = await this.chatModel.countDocuments({ chatSessionId: sessionObjectId });
        if (existingChats === 0) {
          // First message - set title from user message
          await this.chatSessionService.updateSessionTitle(sessionObjectId.toString(), message);
        }
        // Update session timestamp
        await this.chatSessionService.updateSessionTimestamp(sessionObjectId.toString());
      }

      // Save text chat turn: user input with model response in the same document
      await this.chatModel.create({
        chatSessionId: sessionObjectId,
        role: 'user',
        content: message,
        modelResponse: responseText,
        timestamp: new Date(),
        type: 'text',
      });

      return responseText;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getChatHistory(): Promise<Array<{ role: string; content: string; timestamp: Date }>> {
    const chats = await this.chatModel
      .find()
      .sort({ timestamp: 1 })
      .lean();

    // Expand documents: if a document has modelResponse, return both user and model messages
    const messages: Array<{ role: string; content: string; timestamp: Date }> = [];
    
    for (const chat of chats) {
      // Add user message
      messages.push({
        role: chat.role,
        content: chat.content,
        timestamp: chat.timestamp,
      });
      
      // If document has modelResponse, add model message too
      if (chat.modelResponse) {
        messages.push({
          role: 'model',
          content: chat.modelResponse,
          timestamp: chat.timestamp, // Use same timestamp or could add a small offset
        });
      }
    }

    return messages;
  }

  async saveVoiceChatTurn(
    userInput: string,
    modelResponse: string,
    chatSessionId?: string,
  ): Promise<void> {
    try {
      // Convert chatSessionId string to ObjectId if provided
      const sessionObjectId = chatSessionId ? new Types.ObjectId(chatSessionId) : undefined;

      // If this is the first message in a session, update the session title
      if (sessionObjectId) {
        // Check if this is the first message (no previous chats for this session)
        const existingChats = await this.chatModel.countDocuments({ chatSessionId: sessionObjectId });
        if (existingChats === 0) {
          // First message - set title from user input
          await this.chatSessionService.updateSessionTitle(sessionObjectId.toString(), userInput);
        }
        // Update session timestamp
        await this.chatSessionService.updateSessionTimestamp(sessionObjectId.toString());
      }

      // Save voice chat turn: user input with model response in the same document
      await this.chatModel.create({
        chatSessionId: sessionObjectId,
        role: 'user',
        content: userInput,
        modelResponse: modelResponse,
        timestamp: new Date(),
        type: 'voice',
      });
      this.logger.debug(`Saved voice chat turn: user="${userInput.substring(0, 50)}...", model="${modelResponse.substring(0, 50)}..."`);
    } catch (error) {
      this.logger.error('Failed to save voice chat turn', error);
      throw error;
    }
  }
}

