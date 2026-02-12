/**
 * tete-a-tete - Framework-agnostic A2A Protocol Implementation
 * 
 * A simple, zero-dependency implementation of the A2A (Agent-to-Agent) protocol
 * for building agent communication systems.
 * 
 * @example
 * ```typescript
 * import { A2AServer, A2AClient } from 'tete-a-tete';
 * 
 * // Server
 * const server = new A2AServer({
 *   card: { name: 'MyAgent', description: 'A helpful agent' },
 *   onMessage: async (msg, sender) => {
 *     console.log(`From ${sender.name}: ${msg.text}`);
 *     return { text: 'Received!' };
 *   },
 *   secret: 'shared-secret'
 * });
 * server.listen(18790);
 * 
 * // Client
 * const client = new A2AClient();
 * const result = await client.send({
 *   url: 'http://localhost:18790/a2a',
 *   message: { text: 'Hello!' },
 *   secret: 'shared-secret'
 * });
 * ```
 * 
 * @packageDocumentation
 */

// Main classes
export { A2AServer, createServer } from "./server.js";
export { A2AClient, createClient } from "./client.js";

// Agent Card
export { generateAgentCard } from "./agent-card.js";

// Transport utilities (for advanced use)
export {
  readJsonBody,
  sendJson,
  sendJsonRpcError,
  sendJsonRpcSuccess,
  generateMessageId,
  generateTaskId,
  buildMessageSendRequest,
} from "./transport.js";

// Relay Transport
export {
  RelayTransport,
  RelayClient,
  generateKeypair,
  publicKeyToHex,
  hexToPublicKey,
  saveKeypair,
  loadKeypair,
  loadOrGenerateKeypair,
  encryptMessage,
  decryptMessage,
  createNostrEvent,
} from "./relay/index.js";

// Types
export type {
  // Agent Card
  AgentCard,
  AgentCapabilities,
  AgentSkill,

  // Messages
  TextPart,
  DataPart,
  MessagePart,
  A2AMessage,

  // Tasks
  Task,
  TaskStatus,
  TaskState,

  // JSON-RPC
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,

  // Server
  A2AServerConfig,
  MessageHandler,
  IncomingMessage,
  SenderInfo,
  MessageResponse,
  Logger,

  // Client
  SendOptions,
  SendResult,

  // Protocol
  MessageSendParams,
  MessageSendResult,
} from "./types.js";

// Relay Types
export type {
  Keypair,
  EncryptedMessage,
  NostrEvent,
  RelayClientOptions,
  RelayTransportConfig,
  RelayMessage,
  RelaySendResult,
} from "./relay/index.js";

export { JSON_RPC_ERRORS } from "./types.js";
