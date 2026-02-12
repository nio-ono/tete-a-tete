/**
 * A2A Client - sends messages to peer agents
 */

import type {
  SendOptions,
  SendResult,
  JsonRpcResponse,
  MessageSendResult,
  TextPart,
} from "./types.js";
import { buildMessageSendRequest } from "./transport.js";

/**
 * A2A Client for sending messages to other agents
 * 
 * @example
 * ```typescript
 * const client = new A2AClient();
 * 
 * const result = await client.send({
 *   url: 'https://peer-agent.example.com/a2a',
 *   message: { text: 'Hello, peer agent!' },
 *   secret: 'shared-secret-123'
 * });
 * 
 * if (result.success) {
 *   console.log('Response:', result.response);
 * }
 * ```
 */
export class A2AClient {
  private defaultTimeout: number;

  constructor(options: { timeout?: number } = {}) {
    this.defaultTimeout = options.timeout ?? 30000;
  }

  /**
   * Send a message to another agent
   */
  async send(options: SendOptions): Promise<SendResult> {
    const { url, message, secret, senderName, timeout = this.defaultTimeout } = options;

    const jsonRpcRequest = buildMessageSendRequest(message.text, message.data);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    };

    if (senderName) {
      headers["X-A2A-Sender"] = senderName;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(jsonRpcRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const jsonRpcResponse = (await response.json()) as JsonRpcResponse;

      if (jsonRpcResponse.error) {
        return {
          success: false,
          error: `${jsonRpcResponse.error.code}: ${jsonRpcResponse.error.message}`,
        };
      }

      const result = jsonRpcResponse.result as MessageSendResult | undefined;
      let responseText: string | undefined;

      if (result?.message?.parts) {
        const textPart = result.message.parts.find((p) => p.kind === "text") as TextPart | undefined;
        responseText = textPart?.text;
      }

      return {
        success: true,
        taskId: result?.task?.id,
        response: responseText,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          success: false,
          error: `Request timed out after ${timeout}ms`,
        };
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Fetch an agent's card from the well-known URL
   */
  async fetchAgentCard(baseUrl: string): Promise<{ success: boolean; card?: unknown; error?: string }> {
    try {
      // Normalize URL
      const url = baseUrl.endsWith("/")
        ? `${baseUrl}.well-known/agent-card.json`
        : `${baseUrl}/.well-known/agent-card.json`;

      const response = await fetch(url);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const card = await response.json();
      return { success: true, card };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Create a new A2A client instance
 */
export function createClient(options: { timeout?: number } = {}): A2AClient {
  return new A2AClient(options);
}
