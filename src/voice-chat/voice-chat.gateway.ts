import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server as WsServer, WebSocket } from 'ws';
import { GeminiLiveService } from './gemini-live.service';
import { Modality, MediaResolution, Session, LiveServerMessage } from '@google/genai';

type ClientMessage =
  | { type: 'start'; config?: any }
  | { type: 'audio_chunk'; data: string }
  | { type: 'text'; text: string; end?: boolean }
  | { type: 'stop' };

@Injectable()
@WebSocketGateway({ path: '/voice-chat' })
export class VoiceChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server: WsServer;
  private readonly logger = new Logger(VoiceChatGateway.name);
  private clientSessions = new WeakMap<WebSocket, Session>();
  private chunkCounts = new WeakMap<WebSocket, number>();
  private totalBytes = new WeakMap<WebSocket, number>();

  constructor(private readonly live: GeminiLiveService) {}

  afterInit(server: WsServer) {
    this.logger.log('WS Gateway initialized at /voice-chat');
    server.on('connection', (socket: WebSocket) => this.onConnection(socket));
  }

  private async onConnection(socket: WebSocket) {
    this.logger.log('Client connected');
    socket.on('message', (data) => this.onMessage(socket, data));
    socket.on('close', async () => {
      const sess = this.clientSessions.get(socket);
      if (sess) {
        await this.live.end(sess);
        this.clientSessions.delete(socket);
      }
      this.logger.log('Client disconnected');
    });
    this.chunkCounts.set(socket, 0);
    this.totalBytes.set(socket, 0);
  }

  private send(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (e) {
      this.logger.warn('Failed to send to client', e as any);
    }
  }

  private async onMessage(socket: WebSocket, data: WebSocket.RawData) {
    try {
      const payload = JSON.parse(typeof data === 'string' ? data : data.toString()) as ClientMessage;
      if (payload.type === 'start') {
        const session = await this.live.openSession(
          // Official Live-capable model name per docs
          'gemini-2.5-flash-native-audio-preview-09-2025',
          {
            responseModalities: [Modality.AUDIO],
            // Enable transcriptions to get text versions of audio
            inputAudioTranscription: {
              // Transcribe user's speech (input audio)
            },
            outputAudioTranscription: {
              // Transcribe model's speech (output audio)
            },
          },
          {
            onMessage: (m: LiveServerMessage) => this.send(socket, { type: 'server', message: m }),
            onOpen: () => this.send(socket, { type: 'event', event: 'opened' }),
            onError: (e) => this.send(socket, { type: 'event', event: 'error', message: e.message }),
            onClose: (e) => this.send(socket, { type: 'event', event: 'closed', reason: e.reason }),
          },
        );
        this.clientSessions.set(socket, session);
        this.send(socket, { ok: true });
        return;
      }

      const session = this.clientSessions.get(socket);
      if (!session) {
        this.send(socket, { ok: false, error: 'No active session. Send {type:"start"} first.' });
        return;
      }

      if (payload.type === 'audio_chunk') {
        // Approximate decoded PCM size from base64 length
        const approxBytes = Math.floor((payload.data.length * 3) / 4);
        const c = (this.chunkCounts.get(socket) ?? 0) + 1;
        const t = (this.totalBytes.get(socket) ?? 0) + approxBytes;
        this.chunkCounts.set(socket, c);
        this.totalBytes.set(socket, t);
        if (c % 20 === 0) {
          this.logger.debug(`audio_chunk x${c}, total=${t} bytes (~${(t/16000/2).toFixed(2)}s)`);
        }
        await this.live.sendAudio(session, payload.data);
        this.send(socket, { ok: true });
        return;
      }

      if (payload.type === 'text') {
        // Live API sessions are intended for realtime media streaming.
        // Explicit client text messages are not supported in this proxy.
        this.send(socket, { ok: false, error: 'text input not supported in live session' });
        return;
      }

      if (payload.type === 'stop') {
        await this.live.end(session);
        this.clientSessions.delete(socket);
        this.send(socket, { ok: true });
        return;
      }

      this.send(socket, { ok: false, error: 'Unknown message type' });
    } catch (e: any) {
      this.logger.error('Gateway message error', e);
      this.send(socket, { ok: false, error: e?.message ?? 'internal error' });
    }
  }
}


