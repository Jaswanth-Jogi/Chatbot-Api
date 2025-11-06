# Chatbot API

Gemini Multimodal Desktop Chat Application Backend

## Overview

This is a NestJS backend service for the Gemini Multimodal Desktop Chat Application. It provides gRPC services for text chat, voice chat, and ephemeral token generation.

## Features

- **Text Chat**: Send messages and receive responses from Gemini Chat API
- **Voice Chat**: Save voice conversation transcripts
- **Ephemeral Tokens**: Generate secure tokens for client-side Gemini Live API authentication
- **MongoDB**: Persistent storage for chat history and voice transcripts
- **gRPC**: High-performance communication protocol for client-server interaction
- **Health Checks**: gRPC and HTTP health endpoints

## Prerequisites

- Node.js (LTS version recommended)
- MongoDB (local or MongoDB Atlas)
- Google Gemini API key

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3007
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/gemini_chat_app

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here

# gRPC Configuration
GRPC_PORT=50051
```

## Running the Application

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm run start:prod
```

## API Endpoints

### HTTP

- `GET /` - Health check
- `GET /health` - Detailed health status

### gRPC Services

#### ChatService
- `SendMessage(SendMessageRequest) returns (ChatMessage)`
- `GetChatHistory(Empty) returns (ChatHistoryResponse)`

#### VoiceChatService
- `GetEphemeralToken(Empty) returns (EphemeralTokenResponse)`
- `SaveVoiceTurn(SaveVoiceTurnRequest) returns (VoiceTurn)`

#### Health
- `Check(HealthCheckRequest) returns (HealthCheckResponse)`

## Project Structure

```
src/
├── chat/              # Text chat module
├── voice-chat/        # Voice chat module
├── database/          # MongoDB connection module
├── grpc/              # gRPC controllers and services
├── health/            # Health check module
├── schemas/           # MongoDB schemas
├── proto/             # Protocol buffer definitions
├── config/            # Configuration files
├── app.module.ts      # Root module
└── main.ts            # Application entry point
```

## Database Schema

### chats Collection
- `role`: "user" or "model"
- `content`: Message text
- `timestamp`: Message timestamp

### voice_chats Collection
- `user`: User transcription
- `model`: Model transcription
- `timestamp`: Turn completion timestamp

## Development

The project follows NestJS best practices and uses TypeScript for type safety. Proto files define the gRPC contract between client and server.

