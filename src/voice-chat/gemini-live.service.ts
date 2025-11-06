import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Using @google/genai SDK for Live API
// Note: Ensure @google/genai is installed in package.json
import { GoogleGenAI, LiveServerMessage, Modality, MediaResolution, Session } from '@google/genai';

export interface LiveSessionConfig {
  responseModalities?: Modality[];
  mediaResolution?: MediaResolution;
  speechConfig?: Record<string, unknown>;
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
      },
      callbacks: {
        onopen: () => {
          this.logger.debug('Gemini Live session opened');
          callbacks?.onOpen?.();
        },
        onmessage: (message: LiveServerMessage) => {
          try {
            const raw = JSON.stringify(message);
            const preview = raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
            this.logger.debug(`Gemini Live message: ${preview}`);
          } catch (_) {
            this.logger.debug('Gemini Live message received (unserializable)');
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

  async end(session: Session) {
    try {
      session.close();
    } catch (e) {
      this.logger.warn('Error closing session', e as any);
    }
  }
}


