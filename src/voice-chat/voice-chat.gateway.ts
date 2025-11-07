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
            // System instruction: Define AI role for children's voice chat
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
and finally always aware of that you are talking with a child under age 15 years so respond based on that. note that for system questions you can suggest only can't directly do anything like adding subjects etc, guide child. `,
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


