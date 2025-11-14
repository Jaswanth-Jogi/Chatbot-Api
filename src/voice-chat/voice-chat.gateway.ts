import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server as WsServer, WebSocket } from 'ws';
import { GeminiLiveService } from './gemini-live.service';
import { Modality, MediaResolution, Session, LiveServerMessage } from '@google/genai';
import { ChatService } from '../chat/chat.service';
import { ChatSessionService } from '../chat/chat-session.service';
import { PromptsService } from '../prompts/prompts.service';

type ClientMessage =
  | { type: 'start'; config?: any; resumptionHandle?: string; chatSessionId?: string; childId?: string }
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
  // Track current voice chat turn transcriptions per socket
  private currentUserTranscription = new WeakMap<WebSocket, string>();
  private currentModelTranscription = new WeakMap<WebSocket, string>();
  private turnSaved = new WeakMap<WebSocket, boolean>(); // Track if current turn has been saved
  private saveTurnTimeout = new WeakMap<WebSocket, NodeJS.Timeout>(); // Timeout for debounced save after turnComplete
  
  // Session resumption: Token storage and state management
  private socketToId = new Map<WebSocket, string>(); // socket -> unique socketId
  private resumptionTokens = new Map<string, string>(); // socketId -> resumption token
  private tokenExpiration = new Map<string, number>(); // socketId -> expiration timestamp (2 hours)
  private chatSessionIds = new Map<WebSocket, string>(); // socket -> chatSessionId
  private childIds = new Map<WebSocket, string>(); // socket -> childId
  private intentionalStops = new Set<string>(); // socketId -> track intentional stops to prevent auto-reconnection
  private socketState = new Map<string, { // socketId -> state to preserve across reconnections
    userTranscription: string;
    modelTranscription: string;
    turnSaved: boolean;
  }>();
  private reconnectionTimeouts = new Map<string, NodeJS.Timeout>(); // socketId -> reconnection timeout
  private isReconnecting = new Map<string, boolean>(); // socketId -> whether reconnection is in progress
  private reconnectionAttempts = new Map<string, number>(); // socketId -> number of consecutive reconnection attempts

  constructor(
    private readonly live: GeminiLiveService,
    private readonly chatService: ChatService,
    private readonly chatSessionService: ChatSessionService,
    private readonly promptsService: PromptsService,
  ) {}

  private getGenerationSettings() {
    return {
      temperature: 2,                 // Gemini range: 0.0 (deterministic) to 2.0 (creative)
      frequencyPenalty: 0.2,          // Gemini range: -2.0 to 2.0 (scaled by repetition count)
      presencePenalty: -0.2,           // Gemini range: -2.0 to 2.0 (binary once token appears)
      stopSequences: [], // Up to 5 UTF-8 strings; generation stops at first match
      //maxOutputTokens: 300,           // 1 to model.output_token_limit (131072 for this model)
    };
  }

  afterInit(server: WsServer) {
    // this.logger.log('WS Gateway initialized at /voice-chat');
    server.on('connection', (socket: WebSocket) => this.onConnection(socket));
  }

  private async onConnection(socket: WebSocket) {
    this.logger.log('Client connected'); // KEEP: Server connected
    
    // Generate unique socket ID for this connection
    const socketId = this.getSocketId(socket);
    // this.logger.debug(`Socket ID assigned: ${socketId}`);
    
    socket.on('message', (data) => this.onMessage(socket, data));
    socket.on('close', async () => {
      // Save any pending turn before disconnecting
      this.clearSaveTimeout(socket);
      await this.trySaveTurn(socket);
      
      // Save state before cleanup
      this.saveSocketState(socketId, socket);
      
      // Clear reconnection timeout if exists
      const reconnectTimeout = this.reconnectionTimeouts.get(socketId);
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        this.reconnectionTimeouts.delete(socketId);
      }
      
      // Clear reconnection state
      this.isReconnecting.delete(socketId);
      this.reconnectionAttempts.delete(socketId);
      
      const sess = this.clientSessions.get(socket);
      if (sess) {
        await this.live.end(sess);
        this.clientSessions.delete(socket);
      }
      
      // Clean up socket mapping (but keep token and state for potential reconnection)
      this.socketToId.delete(socket);
      this.chatSessionIds.delete(socket);
      this.childIds.delete(socket);
      
      // this.logger.log('Client disconnected');
    });
    this.chunkCounts.set(socket, 0);
    this.totalBytes.set(socket, 0);
    // Initialize transcription tracking
    this.currentUserTranscription.set(socket, '');
    this.currentModelTranscription.set(socket, '');
    this.turnSaved.set(socket, false);
  }

  /**
   * Generate or retrieve unique socket ID for tracking across reconnections
   */
  private getSocketId(socket: WebSocket): string {
    let socketId = this.socketToId.get(socket);
    if (!socketId) {
      // Generate unique ID: socket_timestamp_random
      socketId = `socket_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      this.socketToId.set(socket, socketId);
    }
    return socketId;
  }

  /**
   * Save socket state (transcriptions) for potential reconnection
   */
  private saveSocketState(socketId: string, socket: WebSocket): void {
    this.socketState.set(socketId, {
      userTranscription: this.currentUserTranscription.get(socket) || '',
      modelTranscription: this.currentModelTranscription.get(socket) || '',
      turnSaved: this.turnSaved.get(socket) || false,
    });
  }

  /**
   * Restore socket state from previous connection
   */
  private restoreSocketState(socketId: string, socket: WebSocket): void {
    const state = this.socketState.get(socketId);
    if (state) {
      this.currentUserTranscription.set(socket, state.userTranscription);
      this.currentModelTranscription.set(socket, state.modelTranscription);
      this.turnSaved.set(socket, state.turnSaved);
      // this.logger.debug(`Restored state for socket ${socketId}`);
    }
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
        const socketId = this.getSocketId(socket);
        let resumptionHandle = payload.resumptionHandle;
        const chatSessionId = payload.chatSessionId;
        const childId = payload.childId;
        let isResuming = !!resumptionHandle;
        
        // Validate childId is required
        if (!childId) {
          this.send(socket, { ok: false, error: 'childId is required' });
          return;
        }
        
        // Store childId and chatSessionId for this socket
        this.childIds.set(socket, childId);
        if (chatSessionId) {
          this.chatSessionIds.set(socket, chatSessionId);
        }
        
        // If no resumption handle provided, check database for stored token
        // Verify session belongs to this childId before using token
        if (!isResuming && chatSessionId) {
          try {
            const session = await this.chatSessionService.getSession(chatSessionId);
            // Verify session belongs to this childId
            if (session && session.childId && session.childId.toString() !== childId) {
              this.logger.warn(`Chat session ${chatSessionId} does not belong to childId ${childId}`);
              this.send(socket, { ok: false, error: 'Chat session does not belong to this child' });
              return;
            }
            if (session?.resumptionToken && session?.resumptionTokenExpiration) {
              const expiration = new Date(session.resumptionTokenExpiration);
              if (expiration > new Date()) {
                // Valid stored token found - use it to resume
                resumptionHandle = session.resumptionToken;
                isResuming = true;
                // Store in memory for this session
                this.resumptionTokens.set(socketId, session.resumptionToken);
                this.tokenExpiration.set(socketId, expiration.getTime());
                this.logger.log(`Found valid stored resumption token for chat session ${chatSessionId}, resuming Gemini session`); // KEEP: Resuming with stored token
              } else {
                // Token expired - clear it from database
                this.logger.log(`Stored resumption token expired for chat session ${chatSessionId}, creating fresh session`); // KEEP: Token expired
                await this.chatSessionService.updateResumptionToken(chatSessionId, null, null);
              }
            }
          } catch (error) {
            // this.logger.warn('Failed to check stored resumption token', error);
          }
        }
        
        // Check token expiration if resuming (from either client or database)
        if (isResuming) {
          const expiration = this.tokenExpiration.get(socketId);
          if (expiration && Date.now() > expiration) {
            // this.logger.warn(`Resumption token expired for socket ${socketId}, creating fresh session`);
            // Clear expired token
            this.resumptionTokens.delete(socketId);
            this.tokenExpiration.delete(socketId);
            // Clear from database if chatSessionId exists
            if (chatSessionId) {
              try {
                await this.chatSessionService.updateResumptionToken(chatSessionId, null, null);
              } catch (error) {
                // Ignore errors
              }
            }
            // Fall through to create fresh session
            isResuming = false;
            resumptionHandle = undefined;
          } else if (!expiration) {
            // this.logger.warn(`No expiration found for resumption token, treating as expired`);
            // Fall through to create fresh session
            isResuming = false;
            resumptionHandle = undefined;
          }
        }
        
        // Restore state if resuming
        if (isResuming) {
          this.restoreSocketState(socketId, socket);
          this.logger.log(`Resuming session with handle for socket ${socketId} - connecting to same Gemini session`); // KEEP: Connecting to same session
        } else {
          // Clear any old state for fresh session
          this.socketState.delete(socketId);
          // Reset reconnection attempt counter for fresh session
          this.reconnectionAttempts.delete(socketId);
          this.isReconnecting.delete(socketId);
          this.logger.log(`Starting fresh session for socket ${socketId} - new Gemini session`); // KEEP: New session
        }
        
        // Fetch chat history before opening session (only for fresh sessions and if chatSessionId is provided)
        let chatHistory: Array<{ role: string; content: string; timestamp: Date }> = [];
        if (!isResuming && chatSessionId) {
          try {
            chatHistory = await this.chatService.getChatHistory(chatSessionId);
            // this.logger.debug(`Loaded ${chatHistory.length} messages from chat history for session ${chatSessionId}`);
          } catch (error) {
            // this.logger.warn('Failed to load chat history for voice session', error);
          }
        }

        // Fetch system instruction from database
        const systemInstruction = await this.promptsService.getPromptByTitle('SystemInstruction');
        if (!systemInstruction) {
          this.logger.warn('System instruction not found in database, proceeding without it');
        }

        const session = await this.live.openSession(
          // Official Live-capable model name per docs
          'gemini-2.5-flash-native-audio-preview-09-2025',
          {
            responseModalities: [Modality.AUDIO],
            // Context window compression: Enables unlimited session duration
            // Gemini automatically compresses old context on server side
            contextWindowCompression: {
              slidingWindow: {},
              triggerTokens: "100000",  // Custom: compress at 100k tokens (76% of 131k limit)
            },
            ...this.getGenerationSettings(),
            // Session resumption: Enable for new sessions, use handle for resuming
            sessionResumption: isResuming && resumptionHandle
              ? { handle: resumptionHandle }
              : {}, // Empty object enables resumption for future reconnections
            // Enable transcriptions to get text versions of audio
            inputAudioTranscription: {
              // Transcribe user's speech (input audio)
            },
            outputAudioTranscription: {
              // Transcribe model's speech (output audio)
            },
            // System instruction: Fetch from database
            ...(systemInstruction && { systemInstruction }),
          },
          {
            onMessage: async (m: LiveServerMessage) => {
              // Process transcriptions and save to DB
              await this.handleLiveMessage(socket, m);
              // Forward message to client
              this.send(socket, { type: 'server', message: m });
            },
            onOpen: () => {
              this.send(socket, { type: 'event', event: 'opened' });
            },
            onError: (e) => {
              // this.logger.error(`Gemini Live session error: ${e.message}`);
              this.send(socket, { type: 'event', event: 'error', message: e.message });
              // Clear session on error
              this.clientSessions.delete(socket);
            },
            onClose: async (e) => {
              const socketId = this.getSocketId(socket);
              // this.logger.warn(`Gemini Live session closed: ${e.reason || 'unknown reason'}`);
              
              // Save any pending turn before closing
              this.clearSaveTimeout(socket);
              await this.trySaveTurn(socket);
              
              // Don't delete session yet - wait until new one is ready to avoid race condition
              // Mark as reconnecting to prevent audio chunks from failing immediately
              const resumptionToken = this.resumptionTokens.get(socketId);
              const expiration = this.tokenExpiration.get(socketId);
              
              // Check if we're already reconnecting (prevent recursive calls)
              if (this.isReconnecting.get(socketId)) {
                // Already reconnecting, just clear the old session
                this.clientSessions.delete(socket);
                return;
              }
              
              // Check if this was an intentional stop (user clicked stop button)
              if (this.intentionalStops.has(socketId)) {
                this.logger.log(`Gemini session closed due to intentional stop for socket ${socketId}, not reconnecting`); // KEEP: Intentional stop
                this.clientSessions.delete(socket);
                this.intentionalStops.delete(socketId);
                this.isReconnecting.delete(socketId);
                this.reconnectionAttempts.delete(socketId);
                return;
              }
              
              // Check reconnection attempt limit (max 3 attempts to prevent infinite loops)
              const attempts = this.reconnectionAttempts.get(socketId) || 0;
              if (attempts >= 3) {
                this.logger.warn(`Max reconnection attempts reached for socket ${socketId}, stopping reconnection`); // KEEP: Reconnection failure
                this.clientSessions.delete(socket);
                this.isReconnecting.delete(socketId);
                this.reconnectionAttempts.delete(socketId);
                this.send(socket, { 
                  type: 'event', 
                  event: 'closed', 
                  reason: 'max_reconnection_attempts',
                  needsNewSession: true 
                });
                return;
              }
              
              // Automatically reconnect to Gemini with resumption token if available
              // Keep the same client WebSocket connection - no need to notify client
              if (resumptionToken && expiration && Date.now() < expiration) {
                this.logger.log(`Gemini session closed, automatically reconnecting to Gemini with resumption token for socket ${socketId}`); // KEEP: Reconnection
                this.isReconnecting.set(socketId, true);
                this.reconnectionAttempts.set(socketId, attempts + 1);
                try {
                  await this.reconnectGeminiSession(socket, socketId, resumptionToken);
                } catch (error) {
                  this.logger.error(`Failed to reconnect Gemini session for socket ${socketId}`, error); // KEEP: Reconnection failure
                  this.clientSessions.delete(socket);
                  this.isReconnecting.delete(socketId);
                  // Notify client that a new session is needed
                  this.send(socket, { 
                    type: 'event', 
                    event: 'closed', 
                    reason: e.reason || 'connection_closed',
                    needsNewSession: true 
                  });
                }
              } else {
                // No valid token, clear session and notify client to create new session
                this.clientSessions.delete(socket);
                this.isReconnecting.delete(socketId);
                this.reconnectionAttempts.delete(socketId);
                this.send(socket, { 
                  type: 'event', 
                  event: 'closed', 
                  reason: e.reason || 'connection_closed',
                  needsNewSession: true 
                });
              }
            },
          },
        );
        
        // Store session first
        this.clientSessions.set(socket, session);
        
        // Clear intentional stop flag when starting a new session
        this.intentionalStops.delete(socketId);
        
        // Send chat history as context after session is created (only for fresh sessions)
        if (!isResuming && chatHistory && chatHistory.length > 0) {
          try {
            // Limit to last 5 messages to avoid excessive token usage
            const recentHistory = chatHistory;
            
            // Format history as a single conversation context string
            const contextParts = recentHistory.map((msg) => {
              const role = msg.role === 'user' ? 'User' : 'Assistant';
              return `${role}: ${msg.content}`;
            });
            
            // Combine into a single context message
            const contextText = `[Previous conversation context]\n${contextParts.join('\n\n')}`;
            
                // Send as a single text input (wait a bit for session to be ready)
            setTimeout(async () => {
              try {
                await this.live.sendText(session, contextText);
                // this.logger.debug(`Sent ${recentHistory.length} recent messages from chat history as context`);
              } catch (error) {
                // this.logger.warn('Failed to send chat history context', error);
              }
            }, 500); // Small delay to ensure session is ready
          } catch (error) {
            // this.logger.warn('Failed to prepare chat history context', error);
          }
        }
        
        this.send(socket, { ok: true });
        return;
      }

      const session = this.clientSessions.get(socket);
      if (!session) {
        this.send(socket, { ok: false, error: 'No active session. Send {type:"start"} first.' });
        return;
      }

      if (payload.type === 'audio_chunk') {
        const socketId = this.getSocketId(socket);
        
        // If reconnecting, wait a bit or queue the chunk (for now, just wait)
        if (this.isReconnecting.get(socketId)) {
          // Reconnection in progress - don't send audio yet
          // Client will retry or we can queue, but for simplicity, just acknowledge
          this.send(socket, { ok: false, error: 'Reconnecting, please wait...' });
          return;
        }
        
        // Approximate decoded PCM size from base64 length
        const approxBytes = Math.floor((payload.data.length * 3) / 4);
        const c = (this.chunkCounts.get(socket) ?? 0) + 1;
        const t = (this.totalBytes.get(socket) ?? 0) + approxBytes;
        this.chunkCounts.set(socket, c);
        this.totalBytes.set(socket, t);
        // if (c % 20 === 0) {
        //   this.logger.debug(`audio_chunk x${c}, total=${t} bytes (~${(t/16000/2).toFixed(2)}s)`);
        // }
        try {
          await this.live.sendAudio(session, payload.data);
          this.send(socket, { ok: true });
        } catch (error) {
          // Session might be closed/dead
          // Don't delete session if we're reconnecting - let reconnection handle it
          if (!this.isReconnecting.get(socketId)) {
            this.clientSessions.delete(socket);
            this.send(socket, { 
              ok: false, 
              error: 'Session closed. Please restart the session.',
              needsNewSession: true 
            });
          } else {
            // Reconnection in progress, just acknowledge failure
            this.send(socket, { ok: false, error: 'Reconnecting, please wait...' });
          }
        }
        return;
      }

      if (payload.type === 'text') {
        // Live API sessions are intended for realtime media streaming.
        // Explicit client text messages are not supported in this proxy.
        this.send(socket, { ok: false, error: 'text input not supported in live session' });
        return;
      }

      if (payload.type === 'stop') {
        // Mark this as an intentional stop to prevent auto-reconnection
        const socketId = this.getSocketId(socket);
        this.intentionalStops.add(socketId);
        
        // Clear any pending timeout and save immediately
        this.clearSaveTimeout(socket);
        await this.trySaveTurn(socket);
        
        // Clear all tracking
        this.currentUserTranscription.set(socket, '');
        this.currentModelTranscription.set(socket, '');
        this.turnSaved.set(socket, false);
        
        await this.live.end(session);
        this.clientSessions.delete(socket);
        this.send(socket, { ok: true });
        return;
      }

      this.send(socket, { ok: false, error: 'Unknown message type' });
    } catch (e: any) {
      // this.logger.error('Gateway message error', e);
      this.send(socket, { ok: false, error: e?.message ?? 'internal error' });
    }
  }

  private async handleLiveMessage(socket: WebSocket, message: LiveServerMessage): Promise<void> {
    try {
      const socketId = this.getSocketId(socket);
      
      // Handle SessionResumptionUpdate: Store resumption token
      if ((message as any).sessionResumptionUpdate) {
        const update = (message as any).sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          const token = update.newHandle;
          // Store token with 2-hour expiration (7200000 ms)
          const expiration = Date.now() + 2 * 60 * 60 * 1000;
          const expirationDate = new Date(expiration);
          this.resumptionTokens.set(socketId, token);
          this.tokenExpiration.set(socketId, expiration);
          this.logger.log(`Resumption token received for socket ${socketId}, expires at ${expirationDate.toISOString()}`); // KEEP: Token received
          this.logger.log(`Resumption token: ${token}`); // Print token value
          
          // Save token to database if chatSessionId exists
          const chatSessionId = this.chatSessionIds.get(socket);
          if (chatSessionId) {
            try {
              await this.chatSessionService.updateResumptionToken(chatSessionId, token, expirationDate);
              this.logger.log(`Saved resumption token to database for chat session ${chatSessionId}`); // KEEP: Token saved to DB
            } catch (error) {
              this.logger.warn(`Failed to save resumption token to database for chat session ${chatSessionId}`, error);
            }
          }
          
          // Forward token to client
          this.send(socket, {
            type: 'resumption_token',
            token: token,
            expiration: expiration,
          });
        }
      }
      
      // Handle GoAway: Connection will close soon, schedule reconnection
      if ((message as any).goAway) {
        const goAway = (message as any).goAway;
        const timeLeft = goAway.timeLeft || 30000; // Default 30s if not provided
        this.logger.log(`GoAway received for socket ${socketId}, ${timeLeft}ms until connection closes`); // KEEP: GoAway message
        
        // Save current turn immediately
        this.clearSaveTimeout(socket);
        await this.trySaveTurn(socket);
        
        // Save state before reconnection
        this.saveSocketState(socketId, socket);
        
        // Get resumption token
        const resumptionToken = this.resumptionTokens.get(socketId);
        
        if (resumptionToken) {
          // Check token expiration
          const expiration = this.tokenExpiration.get(socketId);
          if (expiration && Date.now() < expiration) {
            // Mark that we should reconnect when connection closes
            // Don't schedule timer - wait for actual connection close
            this.logger.log(`GoAway received for socket ${socketId}, will automatically reconnect Gemini session on connection close`); // KEEP: Reconnection planned
            
            // Notify client about GoAway (informational only - backend will handle reconnection automatically)
            this.send(socket, {
              type: 'goaway',
              timeLeft: timeLeft,
              willReconnect: true,
            });
            // Note: Backend will automatically reconnect to Gemini in onClose handler - client doesn't need to do anything
          } else {
            // Token expired, notify client to create fresh session
            this.logger.warn(`Resumption token expired for socket ${socketId}, cannot reconnect`); // KEEP: Reconnection failure
            this.send(socket, {
              type: 'goaway',
              timeLeft: timeLeft,
              willReconnect: false,
              reason: 'token_expired',
            });
          }
        } else {
          // No token available, notify client
          this.logger.warn(`No resumption token available for socket ${socketId}, cannot reconnect`); // KEEP: Reconnection failure
          this.send(socket, {
            type: 'goaway',
            timeLeft: timeLeft,
            willReconnect: false,
            reason: 'no_token',
          });
        }
        return; // Don't process other message parts after GoAway
      }
      
      if (!message.serverContent) return;

      const sc = message.serverContent as any;
      
      // Handle usage metadata (token counts) if available
      if ((message as any).usageMetadata) {
        const usage = (message as any).usageMetadata;
        const promptTokens = usage.promptTokenCount || 0;
        const completionTokens = usage.completionTokenCount || 0;
        const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;
        this.logger.log(`Token usage - Prompt: ${promptTokens}, Completion: ${completionTokens}, Total: ${totalTokens}`); // KEEP: Token usage
      }
      
      // Handle generationComplete: Response fully generated
      if (sc.generationComplete) {
        // this.logger.debug('Generation complete - response fully generated');
        // Save any pending turn immediately
        await this.trySaveTurn(socket);
        // Notify client
        this.send(socket, { type: 'generation_complete' });
      }

      // Handle input transcription (user's speech)
      // Note: The API uses "inputTranscription" (not "inputAudioTranscription")
      // It may come incrementally or as complete text
      if (sc.inputTranscription?.text) {
        const userText = sc.inputTranscription.text.trim();
        if (userText) {
          const currentUserTranscription = this.currentUserTranscription.get(socket) || '';
          const isNewTurn = this.turnSaved.get(socket);
          
          if (isNewTurn) {
            // Previous turn was saved, so this is a new turn starting
            // Save any pending turn (shouldn't happen, but safety check)
            this.clearSaveTimeout(socket);
            await this.trySaveTurn(socket);
            
            // Start fresh for new turn
            this.currentUserTranscription.set(socket, userText);
            this.currentModelTranscription.set(socket, '');
            this.turnSaved.set(socket, false);
            // this.logger.debug(`New turn started - User transcription: ${userText}`);
          } else if (currentUserTranscription === '') {
            // First user transcription for this turn
            this.currentUserTranscription.set(socket, userText);
            // this.logger.debug(`User transcription started: ${userText}`);
          } else {
            // Accumulate user transcription (incremental updates for same turn)
            // If new text includes the current text, it's likely a complete replacement
            // Otherwise, append the new chunk
            if (userText.includes(currentUserTranscription) && userText.length > currentUserTranscription.length) {
              // Complete replacement (new text is longer and includes old text)
              this.currentUserTranscription.set(socket, userText);
              // this.logger.debug(`User transcription replaced (complete): ${userText}`);
            } else if (currentUserTranscription.includes(userText)) {
              // New text is already in current - might be duplicate, keep the longer one
              if (userText.length > currentUserTranscription.length) {
                this.currentUserTranscription.set(socket, userText);
              }
              // this.logger.debug(`User transcription (duplicate/refinement): ${userText}`);
            } else {
              // New chunk - append it
              this.currentUserTranscription.set(socket, currentUserTranscription + ' ' + userText);
              // this.logger.debug(`User transcription appended: ${userText} | Total: ${this.currentUserTranscription.get(socket)}`);
            }
            
            // Reset save timeout to wait for more chunks
            this.resetSaveTimeout(socket);
          }
        }
      }

      // Handle output transcription (model's speech) - incremental
      // Note: The API uses "outputTranscription" (not "outputAudioTranscription")
      if (sc.outputTranscription?.text) {
        const modelText = sc.outputTranscription.text;
        if (modelText) {
          // Accumulate model transcription
          const current = this.currentModelTranscription.get(socket) || '';
          this.currentModelTranscription.set(socket, current + modelText);
          // this.logger.debug(`Model transcription updated: ${modelText}`);
          
          // If we have a pending save timeout (after turnComplete), reset it
          // This allows us to wait for more transcription chunks
          this.resetSaveTimeout(socket);
        }
      }

      // Handle turn complete - schedule a debounced save
      // Transcriptions might arrive after turnComplete, so we wait a bit
      if (sc.turnComplete) {
        // this.logger.debug('Turn complete received, scheduling debounced save');
        // Schedule save after a delay to allow final transcriptions to arrive
        this.scheduleSaveTurn(socket, 2000); // Wait 2 seconds after turnComplete
      }
    } catch (error) {
      // this.logger.error('Error handling live message', error);
    }
  }

  private async trySaveTurn(socket: WebSocket): Promise<void> {
    // Skip if already saved this turn
    if (this.turnSaved.get(socket)) {
      return;
    }

    const userTranscription = (this.currentUserTranscription.get(socket) || '').trim();
    const modelTranscription = (this.currentModelTranscription.get(socket) || '').trim();

    if (userTranscription && modelTranscription) {
      try {
        const chatSessionId = this.chatSessionIds.get(socket);
        await this.chatService.saveVoiceChatTurn(userTranscription, modelTranscription, chatSessionId);
        // this.logger.debug(`Saved voice chat turn: user="${userTranscription.substring(0, 50)}...", model="${modelTranscription.substring(0, 50)}..."`);
        
        // Clear timeout since we've saved
        this.clearSaveTimeout(socket);
        
        // Mark as saved and clear transcriptions for next turn
        this.turnSaved.set(socket, true);
        this.currentUserTranscription.set(socket, '');
        this.currentModelTranscription.set(socket, '');
      } catch (error) {
        // this.logger.error('Failed to save voice chat turn', error);
        // Don't clear on error - might retry later
      }
    } else {
      // this.logger.debug(`Cannot save turn yet - user: ${userTranscription ? 'yes' : 'no'}, model: ${modelTranscription ? 'yes' : 'no'}`);
    }
  }

  private scheduleSaveTurn(socket: WebSocket, delayMs: number): void {
    // Clear any existing timeout
    this.clearSaveTimeout(socket);
    
    // Set new timeout to save after delay
    const timeout = setTimeout(async () => {
      // this.logger.debug(`Debounced save timeout fired, attempting to save turn`);
      await this.trySaveTurn(socket);
      this.saveTurnTimeout.delete(socket);
    }, delayMs);
    
    this.saveTurnTimeout.set(socket, timeout);
  }

  private resetSaveTimeout(socket: WebSocket): void {
    // If there's a pending timeout, reset it (debounce)
    const existingTimeout = this.saveTurnTimeout.get(socket);
    if (existingTimeout) {
      // this.logger.debug('Resetting save timeout due to new transcription chunk');
      this.scheduleSaveTurn(socket, 2000); // Reset to 2 seconds
    }
  }

  private clearSaveTimeout(socket: WebSocket): void {
    const timeout = this.saveTurnTimeout.get(socket);
    if (timeout) {
      clearTimeout(timeout);
      this.saveTurnTimeout.delete(socket);
    }
  }

  /**
   * Reconnect Gemini session with resumption token
   * This is called automatically when Gemini session closes (onClose)
   * Keeps the same client WebSocket connection - only reconnects backend-to-Gemini
   */
  private async reconnectGeminiSession(
    socket: WebSocket,
    socketId: string,
    resumptionToken: string,
  ): Promise<void> {
    const chatSessionId = this.chatSessionIds.get(socket);
    
    // Restore socket state if available
    this.restoreSocketState(socketId, socket);
    
    // Fetch system instruction from database
    const systemInstruction = await this.promptsService.getPromptByTitle('SystemInstruction');
    if (!systemInstruction) {
      this.logger.warn('System instruction not found in database during reconnection, proceeding without it');
    }
    
    const newSession = await this.live.openSession(
      'gemini-2.5-flash-native-audio-preview-09-2025',
      {
        responseModalities: [Modality.AUDIO],
        contextWindowCompression: {
          slidingWindow: {},
          triggerTokens: "100000",  // Custom: compress at 100k tokens (76% of 131k limit)
        },
        ...this.getGenerationSettings(),
        // Resume the Gemini session using the resumption token
        sessionResumption: { handle: resumptionToken },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // System instruction: Fetch from database
        ...(systemInstruction && { systemInstruction }),
      },
      {
        onMessage: async (m: LiveServerMessage) => {
          // Process transcriptions and save to DB
          await this.handleLiveMessage(socket, m);
          // Forward message to client
          this.send(socket, { type: 'server', message: m });
        },
        onOpen: () => {
          this.logger.log(`Gemini session reconnected for socket ${socketId} - same Gemini session resumed`); // KEEP: Reconnection success
          this.send(socket, { type: 'event', event: 'opened' });
        },
        onError: (e) => {
          // this.logger.error(`Gemini Live session error: ${e.message}`);
          this.send(socket, { type: 'event', event: 'error', message: e.message });
          // Clear session on error
          this.clientSessions.delete(socket);
        },
        onClose: async (closeEvent) => {
          // Handle recursive reconnection if needed (but with attempt limit)
          const socketIdForClose = this.getSocketId(socket);
          this.clearSaveTimeout(socket);
          await this.trySaveTurn(socket);
          
          // Check if this was an intentional stop (user clicked stop button)
          if (this.intentionalStops.has(socketIdForClose)) {
            this.logger.log(`Gemini session closed due to intentional stop for socket ${socketIdForClose} in recursive handler, not reconnecting`); // KEEP: Intentional stop
            this.clientSessions.delete(socket);
            this.intentionalStops.delete(socketIdForClose);
            this.isReconnecting.delete(socketIdForClose);
            this.reconnectionAttempts.delete(socketIdForClose);
            return;
          }
          
          // Check reconnection attempt limit
          const attempts = this.reconnectionAttempts.get(socketIdForClose) || 0;
          if (attempts >= 3) {
            this.logger.warn(`Max reconnection attempts reached for socket ${socketIdForClose} in recursive handler`); // KEEP: Reconnection failure
            this.clientSessions.delete(socket);
            this.isReconnecting.delete(socketIdForClose);
            this.reconnectionAttempts.delete(socketIdForClose);
            this.send(socket, { 
              type: 'event', 
              event: 'closed', 
              reason: 'max_reconnection_attempts',
              needsNewSession: true 
            });
            return;
          }
          
          // Try to reconnect again if we have a valid token
          const token = this.resumptionTokens.get(socketIdForClose);
          const exp = this.tokenExpiration.get(socketIdForClose);
          
          if (token && exp && Date.now() < exp) {
            this.logger.log(`Gemini session closed again, reconnecting for socket ${socketIdForClose}`); // KEEP: Reconnection
            this.isReconnecting.set(socketIdForClose, true);
            this.reconnectionAttempts.set(socketIdForClose, attempts + 1);
            try {
              await this.reconnectGeminiSession(socket, socketIdForClose, token);
            } catch (error) {
              this.logger.error(`Failed to reconnect Gemini session for socket ${socketIdForClose}`, error); // KEEP: Reconnection failure
              this.clientSessions.delete(socket);
              this.isReconnecting.delete(socketIdForClose);
              this.send(socket, { 
                type: 'event', 
                event: 'closed', 
                reason: closeEvent.reason || 'connection_closed',
                needsNewSession: true 
              });
            }
          } else {
            this.clientSessions.delete(socket);
            this.isReconnecting.delete(socketIdForClose);
            this.reconnectionAttempts.delete(socketIdForClose);
            this.send(socket, { 
              type: 'event', 
              event: 'closed', 
              reason: closeEvent.reason || 'connection_closed',
              needsNewSession: true 
            });
          }
        },
      },
    );
    
    // Store the new session (same socket, new Gemini session)
    // IMPORTANT: Store BEFORE clearing reconnecting flag to avoid race condition
    this.clientSessions.set(socket, newSession);
    
    // Clear reconnecting flag and reset attempt counter on success
    this.isReconnecting.delete(socketId);
    this.reconnectionAttempts.delete(socketId);
    this.intentionalStops.delete(socketId); // Clear intentional stop flag on successful reconnection
    
    this.logger.log(`Gemini session reconnected successfully for socket ${socketId} - client WebSocket unchanged`); // KEEP: Reconnection success
  }
}


