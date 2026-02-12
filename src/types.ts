/**
 * A2A Protocol Types
 * Based on the A2A (Agent-to-Agent) protocol specification
 * https://a2a-protocol.org/latest/specification/
 */

// ============================================================================
// Agent Card (served at /.well-known/agent-card.json)
// ============================================================================

export interface AgentCard {
  /** Agent's display name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** A2A endpoint URL */
  url: string;
  /** Protocol version */
  version: string;
  /** Agent capabilities */
  capabilities: AgentCapabilities;
  /** Supported input MIME types */
  defaultInputModes: string[];
  /** Supported output MIME types */
  defaultOutputModes: string[];
  /** Skills this agent provides */
  skills: AgentSkill[];
}

export interface AgentCapabilities {
  /** Supports streaming responses */
  streaming: boolean;
  /** Supports push notifications */
  pushNotifications?: boolean;
}

export interface AgentSkill {
  /** Unique skill identifier */
  id: string;
  /** Human-readable skill name */
  name: string;
  /** Skill description */
  description?: string;
}

// ============================================================================
// A2A Messages
// ============================================================================

export interface TextPart {
  kind: "text";
  text: string;
}

export interface DataPart {
  kind: "data";
  data: Record<string, unknown>;
}

export type MessagePart = TextPart | DataPart;

export interface A2AMessage {
  role: "user" | "agent";
  parts: MessagePart[];
}

// ============================================================================
// A2A Task
// ============================================================================

export type TaskState = "pending" | "working" | "completed" | "failed";

export interface TaskStatus {
  state: TaskState;
  error?: string;
}

export interface Task {
  id: string;
  status: TaskStatus;
}

// ============================================================================
// JSON-RPC 2.0
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// A2A Method Params/Results
// ============================================================================

export interface MessageSendParams {
  message: A2AMessage;
}

export interface MessageSendResult {
  task: Task;
  message?: A2AMessage;
}

// ============================================================================
// Server Configuration
// ============================================================================

export interface A2AServerConfig {
  /** Agent card information */
  card: {
    name: string;
    description?: string;
  };
  /** Handler for incoming messages */
  onMessage: MessageHandler;
  /** Shared secret for authentication */
  secret: string;
  /** Optional: hostname to bind to (default: '0.0.0.0') */
  hostname?: string;
  /** Optional: custom skills list */
  skills?: AgentSkill[];
  /** Optional: logger */
  logger?: Logger;
}

export type MessageHandler = (
  message: IncomingMessage,
  sender: SenderInfo
) => Promise<MessageResponse> | MessageResponse;

export interface IncomingMessage {
  text: string;
  data?: Record<string, unknown>;
  raw: A2AMessage;
}

export interface SenderInfo {
  name: string;
}

export interface MessageResponse {
  text: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface SendOptions {
  /** Target A2A endpoint URL */
  url: string;
  /** Message to send */
  message: {
    text: string;
    data?: Record<string, unknown>;
  };
  /** Shared secret for authentication */
  secret: string;
  /** Optional: sender name (sent as X-A2A-Sender header) */
  senderName?: string;
  /** Optional: request timeout in milliseconds */
  timeout?: number;
}

export interface SendResult {
  success: boolean;
  taskId?: string;
  response?: string;
  error?: string;
}
