import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server as WsServer, WebSocket } from 'ws';
import { VoiceChatInputGateway } from './voice-chat-input.gateway';

@Injectable()
@WebSocketGateway({ path: '/voice-chat-output' })
export class VoiceChatOutputGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: WsServer;
  private readonly logger = new Logger(VoiceChatOutputGateway.name);

  constructor(private readonly inputGateway: VoiceChatInputGateway) {}

  afterInit(server: WsServer) {
    this.logger.log('Output WS Gateway initialized at /voice-chat-output');
    server.on('connection', (socket: WebSocket) => {
      socket.on('message', (data) => {
        try {
          const payload = JSON.parse(typeof data === 'string' ? data : data.toString());
          if (payload.type === 'register' && payload.sessionId) {
            // Register this output socket with the session ID
            this.inputGateway.registerOutputSocket(payload.sessionId, socket);
            this.logger.log(`Output socket registered for session: ${payload.sessionId}`);
            socket.send(JSON.stringify({ ok: true, registered: true }));
          }
        } catch (e) {
          this.logger.error('Error processing output socket message', e);
        }
      });
    });
  }

  handleConnection(client: WebSocket) {
    this.logger.log('Output channel client connected');
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Output channel client disconnected');
  }
}

