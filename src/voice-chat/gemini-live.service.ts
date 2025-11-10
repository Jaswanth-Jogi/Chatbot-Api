import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Using @google/genai SDK for Live API
// Note: Ensure @google/genai is installed in package.json
import { GoogleGenAI, LiveServerMessage, Modality, MediaResolution, Session } from '@google/genai';

export interface LiveSessionConfig {
  responseModalities?: Modality[];
  mediaResolution?: MediaResolution;
  speechConfig?: Record<string, unknown>;
  inputAudioTranscription?: Record<string, unknown>;
  outputAudioTranscription?: Record<string, unknown>;
  systemInstruction?: string | { parts: Array<{ text: string }> };
  contextWindowCompression?: {
    slidingWindow?: {};
    triggerTokens?: string;  // SDK expects string, not number
  };
  sessionResumption?: {
    handle?: string;  // Resumption token for resuming a session
  };
}

export interface LiveSession {
  id: string;
  session: Session;
}

@Injectable()
export class GeminiLiveService {
  private readonly logger = new Logger(GeminiLiveService.name);
  private ai: GoogleGenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.ai = new GoogleGenAI({ apiKey });
  }

  async openSession(model: string, config?: LiveSessionConfig, callbacks?: {
    onMessage?: (msg: LiveServerMessage) => void;
    onOpen?: () => void;
    onError?: (err: ErrorEvent) => void;
    onClose?: (e: CloseEvent) => void;
  }): Promise<Session> {
    const session = await this.ai.live.connect({
      model,
      config: {
        // Keep config minimal to avoid invalid-argument on open
        responseModalities: config?.responseModalities ?? [Modality.AUDIO],
        ...(config?.mediaResolution && { mediaResolution: config.mediaResolution }),
        ...(config?.speechConfig && { speechConfig: config.speechConfig }),
        ...(config?.inputAudioTranscription && { inputAudioTranscription: config.inputAudioTranscription }),
        ...(config?.outputAudioTranscription && { outputAudioTranscription: config.outputAudioTranscription }),
        ...(config?.systemInstruction && { systemInstruction: config.systemInstruction }),
        ...(config?.contextWindowCompression && { contextWindowCompression: config.contextWindowCompression }),
        // Session resumption: Enable if handle provided (resume) or empty object (enable for future resumption)
        ...(config?.sessionResumption !== undefined && { sessionResumption: config.sessionResumption }),
      },
      callbacks: {
        onopen: () => {
          this.logger.debug('Gemini Live session opened');
          callbacks?.onOpen?.();
        },
        onmessage: (message: LiveServerMessage) => {
          try {
            // Print full message structure
            const fullMessage = JSON.stringify(message, null, 2);
            this.logger.log('=== Gemini Live Full Response ===');
            this.logger.log(fullMessage);
            
            // Extract and log transcriptions if present
            if (message.serverContent) {
              const sc = message.serverContent as any;
              
              // Input transcription (user's speech)
              if (sc.inputAudioTranscription) {
                this.logger.log('--- INPUT TRANSCRIPTION (User Speech) ---');
                this.logger.log(JSON.stringify(sc.inputAudioTranscription, null, 2));
              }
              
              // Output transcription (model's speech)
              if (sc.outputAudioTranscription) {
                this.logger.log('--- OUTPUT TRANSCRIPTION (Model Speech) ---');
                this.logger.log(JSON.stringify(sc.outputAudioTranscription, null, 2));
              }
              
              // Model turn with text parts
              if (sc.modelTurn?.parts) {
                const textParts = sc.modelTurn.parts
                  .filter((p: any) => p.text)
                  .map((p: any) => p.text);
                if (textParts.length > 0) {
                  this.logger.log('--- MODEL TEXT PARTS ---');
                  textParts.forEach((text: string, idx: number) => {
                    this.logger.log(`Text Part ${idx + 1}: ${text}`);
                  });
                }
              }
              
              // Turn complete indicator
              if (sc.turnComplete) {
                this.logger.log('--- TURN COMPLETE ---');
              }
            }
            
            this.logger.log('=== End of Response ===\n');
          } catch (e) {
            this.logger.error('Error parsing Live message:', e);
            this.logger.debug('Raw message received (unserializable)');
          }
          callbacks?.onMessage?.(message);
        },
        onerror: (e: ErrorEvent) => {
          this.logger.error(`Gemini Live error: ${e.message}`);
          callbacks?.onError?.(e);
        },
        onclose: (e: CloseEvent) => {
          this.logger.debug(`Gemini Live closed: ${e.reason}`);
          callbacks?.onClose?.(e);
        },
      },
    });
    return session;
  }

  async sendAudio(session: Session, base64PcmChunk: string) {
    // Realtime input API per Live docs uses 'media'
    await session.sendRealtimeInput({
      media: {
        mimeType: 'audio/pcm;rate=16000',
        data: base64PcmChunk,
      },
    });
  }

  async sendText(session: Session, text: string) {
    // Send text context to the Live API session
    await session.sendRealtimeInput({
      text: text,
    });
  }

  async end(session: Session) {
    try {
      session.close();
    } catch (e) {
      this.logger.warn('Error closing session', e as any);
    }
  }
}


