# tête-à-tête

A framework-agnostic implementation of the [A2A (Agent-to-Agent) protocol](https://a2a-protocol.org/) for building agent communication systems.

**Zero dependencies.** Works with any agent framework (OpenClaw, LangChain, AutoGPT, custom implementations).

## Installation

```bash
npm install tete-a-tete
```

## Quick Start

### Server (Receiving Messages)

```typescript
import { A2AServer } from 'tete-a-tete';

const server = new A2AServer({
  card: {
    name: 'MyAgent',
    description: 'A helpful assistant agent'
  },
  onMessage: async (msg, sender) => {
    console.log(`Received from ${sender.name}: ${msg.text}`);
    
    // Process the message...
    // Return a response
    return { text: 'Message received and processed!' };
  },
  secret: 'your-shared-secret'
});

server.listen(18790, () => {
  console.log('A2A server running on port 18790');
});
```

### Client (Sending Messages)

```typescript
import { A2AClient } from 'tete-a-tete';

const client = new A2AClient();

const result = await client.send({
  url: 'http://localhost:18790/a2a',
  message: { text: 'Hello from another agent!' },
  secret: 'your-shared-secret',
  senderName: 'ClientAgent'
});

if (result.success) {
  console.log('Response:', result.response);
  console.log('Task ID:', result.taskId);
} else {
  console.error('Error:', result.error);
}
```

## API Reference

### A2AServer

Creates an HTTP server that implements the A2A protocol.

```typescript
const server = new A2AServer(config);
```

#### Config Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `card.name` | `string` | Yes | Agent's display name |
| `card.description` | `string` | No | Human-readable description |
| `onMessage` | `function` | Yes | Handler for incoming messages |
| `secret` | `string` | Yes | Shared secret for authentication |
| `hostname` | `string` | No | Hostname to bind to (default: `0.0.0.0`) |
| `skills` | `AgentSkill[]` | No | Custom skills list |
| `logger` | `Logger` | No | Custom logger |

#### Methods

```typescript
// Start the server
server.listen(port: number, callback?: () => void): void

// Stop the server
await server.close(): Promise<void>

// Get the generated agent card
server.getAgentCard(): AgentCard | null
```

### A2AClient

Client for sending messages to A2A-compatible agents.

```typescript
const client = new A2AClient(options?);
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `30000` | Default request timeout in ms |

#### Methods

```typescript
// Send a message
await client.send(options: SendOptions): Promise<SendResult>

// Fetch an agent's card
await client.fetchAgentCard(baseUrl: string): Promise<{ success: boolean; card?: AgentCard; error?: string }>
```

#### SendOptions

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `url` | `string` | Yes | Target A2A endpoint URL |
| `message.text` | `string` | Yes | Message text |
| `message.data` | `object` | No | Structured data payload |
| `secret` | `string` | Yes | Shared secret for auth |
| `senderName` | `string` | No | Name sent in X-A2A-Sender header |
| `timeout` | `number` | No | Request timeout in ms |

### Message Handler

The `onMessage` handler receives incoming messages and returns a response:

```typescript
const handler: MessageHandler = async (msg, sender) => {
  // msg.text - The message text
  // msg.data - Optional structured data
  // msg.raw  - The raw A2A message object
  // sender.name - Sender's name (from X-A2A-Sender header)
  
  return {
    text: 'Response text',
    data: { optional: 'structured data' }
  };
};
```

## Protocol Details

### Endpoints

The server exposes two endpoints:

- `GET /.well-known/agent-card.json` - Agent Card (no auth required)
- `POST /a2a` - A2A messages (requires Bearer token)

### Agent Card

Served at `/.well-known/agent-card.json`:

```json
{
  "name": "MyAgent",
  "description": "A helpful assistant",
  "url": "http://localhost:18790/a2a",
  "version": "1.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "message",
      "name": "Receive Message",
      "description": "Receive a text message from another agent"
    }
  ]
}
```

### Message Format (JSON-RPC 2.0)

Request:

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        { "kind": "text", "text": "Hello!" },
        { "kind": "data", "data": { "context": "value" } }
      ]
    }
  },
  "id": "msg-123"
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {
      "id": "task-456",
      "status": { "state": "completed" }
    },
    "message": {
      "role": "agent",
      "parts": [
        { "kind": "text", "text": "Message received!" }
      ]
    }
  },
  "id": "msg-123"
}
```

## Examples

### Echo Server

```typescript
import { A2AServer } from 'tete-a-tete';

const server = new A2AServer({
  card: { name: 'Echo' },
  onMessage: async (msg) => ({ text: `You said: ${msg.text}` }),
  secret: 'echo-secret'
});

server.listen(18790);
```

### With Structured Data

```typescript
// Server
const server = new A2AServer({
  card: { name: 'DataAgent' },
  onMessage: async (msg, sender) => {
    const requestId = msg.data?.requestId;
    return {
      text: 'Processed',
      data: { requestId, status: 'completed', timestamp: Date.now() }
    };
  },
  secret: 'data-secret'
});

// Client
const result = await client.send({
  url: 'http://localhost:18790/a2a',
  message: {
    text: 'Process this',
    data: { requestId: 'req-123', payload: { foo: 'bar' } }
  },
  secret: 'data-secret'
});
```

### Custom Logger

```typescript
const server = new A2AServer({
  card: { name: 'MyAgent' },
  onMessage: async (msg) => ({ text: 'OK' }),
  secret: 'secret',
  logger: {
    info: (msg) => myLogger.info(msg),
    warn: (msg) => myLogger.warn(msg),
    error: (msg) => myLogger.error(msg),
  }
});
```

### Graceful Shutdown

```typescript
const server = new A2AServer({ ... });
server.listen(18790);

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  A2AServerConfig,
  SendOptions,
  SendResult,
  AgentCard,
  MessageHandler,
  IncomingMessage,
  SenderInfo,
  MessageResponse,
} from 'tete-a-tete';
```

## License

MIT
