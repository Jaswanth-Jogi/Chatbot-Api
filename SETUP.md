# Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following:

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

### 3. MongoDB Setup

Make sure MongoDB is running locally, or update `MONGODB_URI` to point to your MongoDB Atlas cluster.

For local MongoDB:
```bash
# macOS (using Homebrew)
brew services start mongodb-community

# Or using Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### 4. Get Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Add it to your `.env` file

### 5. Start the Server

```bash
npm run start:dev
```

The server should start on:
- HTTP: `http://localhost:3007`
- gRPC: `0.0.0.0:50051`

### 6. Verify Installation

- Check HTTP health: `curl http://localhost:3007/health`
- Check root endpoint: `curl http://localhost:3007/`

## Testing gRPC Services

You can test gRPC services using tools like:
- [grpcurl](https://github.com/fullstorydev/grpcurl)
- [BloomRPC](https://github.com/uw-labs/bloomrpc)
- Postman (with gRPC support)

### Example grpcurl commands:

List services:
```bash
grpcurl -plaintext localhost:50051 list
```

Test ChatService:
```bash
grpcurl -plaintext -d '{"message": "Hello", "history": []}' \
  localhost:50051 chat.v1.ChatService/SendMessage
```

Get chat history:
```bash
grpcurl -plaintext -d '{}' \
  localhost:50051 chat.v1.ChatService/GetChatHistory
```

Get ephemeral token:
```bash
grpcurl -plaintext -d '{}' \
  localhost:50051 voicechat.v1.VoiceChatService/GetEphemeralToken
```

## Troubleshooting

### MongoDB Connection Issues
- Verify MongoDB is running: `mongosh` or `mongo`
- Check connection string format
- Ensure network access if using MongoDB Atlas

### gRPC Issues
- Verify port 50051 is not in use
- Check firewall settings
- Ensure proto files are in `src/proto/`

### Gemini API Issues
- Verify API key is valid
- Check API quotas and limits
- Ensure internet connectivity

