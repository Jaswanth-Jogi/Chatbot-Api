import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server as WsServer, WebSocket } from 'ws';
import { GeminiLiveService } from './gemini-live.service';
import { Modality, Session } from '@google/genai';

type ClientMessage =
  | { type: 'start'; config?: any }
  | { type: 'audio_chunk'; data: string }
  | { type: 'text'; text: string; end?: boolean }
  | { type: 'stop' };

@Injectable()
@WebSocketGateway({ path: '/voice-chat-input' })
export class VoiceChatInputGateway implements OnGatewayInit {
  @WebSocketServer()
  server: WsServer;
  private readonly logger = new Logger(VoiceChatInputGateway.name);
  private clientSessions = new WeakMap<WebSocket, Session>();
  private chunkCounts = new WeakMap<WebSocket, number>();
  private totalBytes = new WeakMap<WebSocket, number>();
  private sessionToOutputSocket = new Map<string, WebSocket>(); // Map session ID to output socket
  private socketToSessionId = new WeakMap<WebSocket, string>(); // Map input socket to session ID
  private sessionMessageBuffers = new Map<string, unknown[]>(); // Buffer messages until output socket is registered

  constructor(private readonly live: GeminiLiveService) {}

  afterInit(server: WsServer) {
    this.logger.log('Input WS Gateway initialized at /voice-chat-input');
    server.on('connection', (socket: WebSocket) => this.onConnection(socket));
  }

  // Method to register output socket with session ID
  registerOutputSocket(sessionId: string, outputSocket: WebSocket) {
    this.sessionToOutputSocket.set(sessionId, outputSocket);
    this.logger.log(`Registered output socket for session: ${sessionId}`);
    
    // Flush any buffered messages
    const buffered = this.sessionMessageBuffers.get(sessionId);
    if (buffered && buffered.length > 0) {
      this.logger.log(`Flushing ${buffered.length} buffered messages for session: ${sessionId}`);
      buffered.forEach((msg) => {
        if (outputSocket.readyState === WebSocket.OPEN) {
          try {
            outputSocket.send(JSON.stringify(msg));
          } catch (e) {
            this.logger.warn('Failed to send buffered message', e as any);
          }
        }
      });
      this.sessionMessageBuffers.delete(sessionId);
    }
  }

  private async onConnection(socket: WebSocket) {
    this.logger.log('Input channel client connected');
    socket.on('message', (data) => this.onMessage(socket, data));
    socket.on('close', async () => {
      const sess = this.clientSessions.get(socket);
      if (sess) {
        await this.live.end(sess);
        this.clientSessions.delete(socket);
      }
      const sessionId = this.socketToSessionId.get(socket);
      if (sessionId) {
        this.sessionToOutputSocket.delete(sessionId);
        this.socketToSessionId.delete(socket);
        this.sessionMessageBuffers.delete(sessionId);
      }
      this.logger.log('Input channel client disconnected');
    });
    this.chunkCounts.set(socket, 0);
    this.totalBytes.set(socket, 0);
  }

  private sendToOutput(socket: WebSocket, payload: unknown) {
    const sessionId = this.socketToSessionId.get(socket);
    if (!sessionId) {
      this.logger.warn('No session ID for input socket - cannot route to output channel');
      return;
    }
    const outputSocket = this.sessionToOutputSocket.get(sessionId);
    if (outputSocket && outputSocket.readyState === WebSocket.OPEN) {
      try {
        const payloadStr = JSON.stringify(payload);
        outputSocket.send(payloadStr);
        // Log message type for debugging
        const payloadObj = payload as any;
        const msgType = payloadObj?.type || payloadObj?.message?.serverContent ? 'serverContent' : 'other';
        this.logger.debug(`[OUTPUT CHANNEL] Sent ${msgType} message to session: ${sessionId}`);
      } catch (e) {
        this.logger.warn('Failed to send to output channel', e as any);
      }
    } else {
      // Buffer the message until output socket is registered
      if (!this.sessionMessageBuffers.has(sessionId)) {
        this.sessionMessageBuffers.set(sessionId, []);
      }
      this.sessionMessageBuffers.get(sessionId)!.push(payload);
      this.logger.debug(`Buffered message for session: ${sessionId} (output socket not yet registered)`);
    }
  }

  private async onMessage(socket: WebSocket, data: WebSocket.RawData) {
    try {
      const payload = JSON.parse(typeof data === 'string' ? data : data.toString()) as ClientMessage;
      
      if (payload.type === 'start') {
        // Generate a unique session ID
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const session = await this.live.openSession(
          'gemini-2.5-flash-native-audio-preview-09-2025',
          {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: `role : you are "Oriel", a child personal companian and a whole system yourself.
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
and finally always aware of that you are talking with a child under age 15 years so respond based on that.`,
          },
          {
            onMessage: (m) => this.sendToOutput(socket, { type: 'server', message: m }),
            onOpen: () => this.sendToOutput(socket, { type: 'event', event: 'opened' }),
            onError: (e) => this.sendToOutput(socket, { type: 'event', event: 'error', message: e.message }),
            onClose: (e) => this.sendToOutput(socket, { type: 'event', event: 'closed', reason: e.reason }),
          },
        );
        this.clientSessions.set(socket, session);
        this.socketToSessionId.set(socket, sessionId);
        // CRITICAL: Only send sessionId to input channel - this is the ONLY message that should go to input channel
        // ALL other output (transcriptions, audio, events, responses) MUST go through output channel via sendToOutput()
        // NEVER send output data directly to input socket - it will cause data mixing!
        try {
          const sessionIdMsg = JSON.stringify({ ok: true, sessionId });
          socket.send(sessionIdMsg);
          this.logger.log(`[INPUT CHANNEL ONLY] Sent session ID ${sessionId} to input channel`);
          this.logger.log(`[INPUT CHANNEL ONLY] This is the ONLY message that should be sent to input channel`);
        } catch (e) {
          this.logger.error('Failed to send sessionId to input channel', e as any);
        }
        return;
      }

      const session = this.clientSessions.get(socket);
      if (!session) {
        // Error responses should also go to output channel, not input
        this.sendToOutput(socket, { ok: false, error: 'No active session. Send {type:"start"} first.' });
        return;
      }

      if (payload.type === 'audio_chunk') {
        const approxBytes = Math.floor((payload.data.length * 3) / 4);
        const c = (this.chunkCounts.get(socket) ?? 0) + 1;
        const t = (this.totalBytes.get(socket) ?? 0) + approxBytes;
        this.chunkCounts.set(socket, c);
        this.totalBytes.set(socket, t);
        if (c % 20 === 0) {
          this.logger.debug(`audio_chunk x${c}, total=${t} bytes (~${(t/16000/2).toFixed(2)}s)`);
        }
        await this.live.sendAudio(session, payload.data);
        this.sendToOutput(socket, { ok: true });
        return;
      }

      if (payload.type === 'text') {
        this.sendToOutput(socket, { ok: false, error: 'text input not supported in live session' });
        return;
      }

      if (payload.type === 'stop') {
        await this.live.end(session);
        this.clientSessions.delete(socket);
        const sessionId = this.socketToSessionId.get(socket);
        if (sessionId) {
          this.sessionToOutputSocket.delete(sessionId);
          this.socketToSessionId.delete(socket);
          this.sessionMessageBuffers.delete(sessionId);
        }
        this.sendToOutput(socket, { ok: true });
        return;
      }

      this.sendToOutput(socket, { ok: false, error: 'Unknown message type' });
    } catch (e: any) {
      this.logger.error('Input gateway message error', e);
      this.sendToOutput(socket, { ok: false, error: e?.message ?? 'internal error' });
    }
  }
}

