import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VoiceChat, VoiceChatDocument } from '../schemas/voice-chat.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VoiceChatService {
  private genAI: GoogleGenerativeAI;

  constructor(
    @InjectModel(VoiceChat.name)
    private readonly voiceChatModel: Model<VoiceChatDocument>,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async saveVoiceTurn(user: string, model: string): Promise<VoiceChat> {
    const voiceTurn = await this.voiceChatModel.create({
      user,
      model,
      timestamp: new Date(),
    });

    return voiceTurn;
  }

  async getEphemeralToken(): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured');
      }

      // According to documentation: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
      // Ephemeral tokens require the v1alpha API version and @google/genai package
      // Create client with v1alpha API version for ephemeral tokens
      const client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      // Calculate expiration times
      const now = new Date();
      const expireTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes
      const newSessionExpireTime = new Date(now.getTime() + 1 * 60 * 1000); // 1 minute

      // Create ephemeral token according to documentation
      // https://ai.google.dev/gemini-api/docs/ephemeral-tokens
      const token = await client.authTokens.create({
        config: {
          uses: 1, // Token can only be used to start a single session
          expireTime: expireTime.toISOString(),
          newSessionExpireTime: newSessionExpireTime.toISOString(),
          httpOptions: { apiVersion: 'v1alpha' },
        },
      });

      // Return the token name (this is what the client uses as the API key)
      // According to docs, the token value is in token.name
      if (!token.name) {
        throw new Error('Ephemeral token name is missing from response');
      }
      return token.name;
    } catch (error) {
      console.error('Error generating ephemeral token:', error);
      throw new Error(
        `Failed to generate ephemeral token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

