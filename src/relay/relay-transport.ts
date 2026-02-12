/**
 * Relay-based P2P Transport for A2A Protocol
 */

import { EventEmitter } from "node:events";
import type {
  A2AMessage,
  MessageHandler,
  IncomingMessage,
  SenderInfo,
  MessageResponse,
  Logger,
  JsonRpcRequest,
  MessageSendParams,
  MessageSendResult,
  TextPart,
  DataPart,
} from "../types.js";
import { generateTaskId, generateMessageId } from "../transport.js";
import type { Keypair } from "./keypair.js";
import { publicKeyToHex, hexToPublicKey } from "./keypair.js";
import { encryptMessage, decryptMessage, type EncryptedMessage } from "./encryption.js";
import { RelayClient, createNostrEvent, getNostrPubkey, type NostrEvent } from "./relay-client.js";

/**
 * Relay transport configuration
 */
export interface RelayTransportConfig {
  /** Our keypair */
  keypair: Keypair;
  /** Message handler */
  onMessage: MessageHandler;
  /** List of relay URLs to connect to */
  relays: string[];
  /** Optional logger */
  logger?: Logger;
  /** Agent name */
  agentName?: string;
}

/**
 * Message to send via relay
 */
export interface RelayMessage {
  /** Recipient's public key (hex) */
  recipientPubKey: string;
  /** Message text */
  text: string;
  /** Optional structured data */
  data?: Record<string, unknown>;
  /** Sender name */
  senderName?: string;
}

/**
 * Send result
 */
export interface RelaySendResult {
  success: boolean;
  taskId?: string;
  response?: string;
  error?: string;
}

const defaultLogger: Logger = {
  info: (msg) => console.log(`[relay] ${msg}`),
  warn: (msg) => console.warn(`[relay] ${msg}`),
  error: (msg) => console.error(`[relay] ${msg}`),
};

/**
 * A2A transport over Nostr relays
 */
export class RelayTransport extends EventEmitter {
  private config: RelayTransportConfig;
  private logger: Logger;
  private clients: RelayClient[] = [];
  private identity: string;
  private nostrPubkey: string;
  private subscriptionId: string;
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: RelaySendResult) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(config: RelayTransportConfig) {
    super();
    this.config = config;
    this.logger = config.logger ?? defaultLogger;
    this.identity = publicKeyToHex(config.keypair.publicKey);
    this.nostrPubkey = getNostrPubkey(config.keypair.privateKey);
    this.subscriptionId = `sub-${Date.now()}`;
  }

  /**
   * Get our public key (identity)
   */
  getPublicKey(): string {
    return this.identity;
  }

  /**
   * Connect to relays and start listening
   */
  async connect(): Promise<void> {
    for (const relayUrl of this.config.relays) {
      try {
        const client = new RelayClient({ url: relayUrl, autoReconnect: true });

        client.on("connected", () => {
          this.logger.info(`Connected to relay: ${relayUrl}`);
        });

        client.on("disconnected", () => {
          this.logger.warn(`Disconnected from relay: ${relayUrl}`);
        });

        client.on("error", (err) => {
          this.logger.error(`Relay error (${relayUrl}): ${err.message}`);
        });

        client.on("event", (event) => {
          this.handleEvent(event).catch((err) => {
            this.logger.error(`Error handling event: ${err instanceof Error ? err.message : String(err)}`);
          });
        });

        await client.connect();

        // Subscribe to messages for our public key (kind 4 = encrypted direct messages in Nostr)
        // Subscribe to messages tagged with our Ed25519 identity
        // We use a custom "t" tag with our identity since peers know our Ed25519 pubkey
        client.subscribe(this.subscriptionId, {
          kinds: [4],
          "#t": [this.identity],
        });

        this.clients.push(client);
      } catch (err) {
        this.logger.error(`Failed to connect to ${relayUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (this.clients.length === 0) {
      throw new Error("Failed to connect to any relay");
    }

    this.logger.info(`Listening on ${this.clients.length} relay(s) as ${this.identity} (nostr: ${this.nostrPubkey.slice(0, 16)}...)`);
  }

  /**
   * Disconnect from all relays
   */
  async disconnect(): Promise<void> {
    for (const client of this.clients) {
      client.disconnect();
    }
    this.clients = [];

    // Reject all pending requests
    for (const [reqId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        error: "Transport disconnected",
      });
    }
    this.pendingRequests.clear();

    this.logger.info("Disconnected from all relays");
  }

  /**
   * Send a message to a peer
   */
  async send(message: RelayMessage, timeout = 30000): Promise<RelaySendResult> {
    return new Promise((resolve) => {
      try {
        const recipientPubKey = hexToPublicKey(message.recipientPubKey);

        // Build A2A JSON-RPC request
        const parts: Array<TextPart | DataPart> = [{ kind: "text", text: message.text }];
        if (message.data) {
          parts.push({ kind: "data", data: message.data });
        }

        const jsonRpcRequest: JsonRpcRequest = {
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts,
            },
            sender: message.senderName || this.config.agentName || "unknown",
          },
          id: generateMessageId(),
        };

        // Encrypt the request
        const encrypted = encryptMessage(JSON.stringify(jsonRpcRequest), this.config.keypair, recipientPubKey);

        // Create Nostr event (kind 4 = encrypted DM)
        const event = createNostrEvent({
          pubkey: this.identity,
          kind: 4,
          content: JSON.stringify(encrypted),
          tags: [["p", message.recipientPubKey], ["t", message.recipientPubKey]],
          privateKey: this.config.keypair.privateKey,
        });

        // Track this request
        const timeoutTimer = setTimeout(() => {
          this.pendingRequests.delete(jsonRpcRequest.id as string);
          resolve({
            success: false,
            error: `Request timed out after ${timeout}ms`,
          });
        }, timeout);

        this.pendingRequests.set(jsonRpcRequest.id as string, {
          resolve,
          timeout: timeoutTimer,
        });

        // Publish to all connected relays
        let published = false;
        for (const client of this.clients) {
          if (client.isConnected()) {
            client.publish(event).catch((err) => {
              this.logger.error(`Failed to publish to relay: ${err instanceof Error ? err.message : String(err)}`);
            });
            published = true;
          }
        }

        if (!published) {
          clearTimeout(timeoutTimer);
          this.pendingRequests.delete(jsonRpcRequest.id as string);
          resolve({
            success: false,
            error: "No connected relays",
          });
        }
      } catch (err) {
        resolve({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /**
   * Handle incoming Nostr event
   */
  private async handleEvent(event: NostrEvent): Promise<void> {
    try {
      // Decrypt the message
      const encrypted: EncryptedMessage = JSON.parse(event.content);
      const decrypted = decryptMessage(encrypted, this.config.keypair);

      if (!decrypted.success) {
        this.logger.warn(`Failed to decrypt message: ${decrypted.error}`);
        return;
      }

      // Parse JSON-RPC
      const jsonRpc = JSON.parse(decrypted.plaintext);

      // Check if this is a response to one of our requests
      if (jsonRpc.result || jsonRpc.error) {
        this.handleResponse(jsonRpc);
        return;
      }

      // This is a new request
      if (jsonRpc.method === "message/send") {
        await this.handleIncomingMessage(jsonRpc, encrypted.senderPubKey);
      }
    } catch (err) {
      this.logger.error(`Error processing event: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handle response to our request
   */
  private handleResponse(jsonRpcResponse: any): void {
    const pending = this.pendingRequests.get(jsonRpcResponse.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(jsonRpcResponse.id);

    if (jsonRpcResponse.error) {
      pending.resolve({
        success: false,
        error: `${jsonRpcResponse.error.code}: ${jsonRpcResponse.error.message}`,
      });
      return;
    }

    const result = jsonRpcResponse.result as MessageSendResult | undefined;
    let responseText: string | undefined;

    if (result?.message?.parts) {
      const textPart = result.message.parts.find((p) => p.kind === "text") as TextPart | undefined;
      responseText = textPart?.text;
    }

    pending.resolve({
      success: true,
      taskId: result?.task?.id,
      response: responseText,
    });
  }

  /**
   * Handle incoming message request
   */
  private async handleIncomingMessage(jsonRpcRequest: any, senderPubKey: string): Promise<void> {
    const params = jsonRpcRequest.params as MessageSendParams & { sender?: string };

    if (!params?.message) {
      return;
    }

    const message = params.message;
    const textPart = message.parts.find((p) => p.kind === "text") as TextPart | undefined;
    const dataPart = message.parts.find((p) => p.kind === "data") as DataPart | undefined;

    if (!textPart?.text) {
      return;
    }

    const incomingMessage: IncomingMessage = {
      text: textPart.text,
      data: dataPart?.data,
      raw: message,
    };

    const senderInfo: SenderInfo = {
      name: params.sender || senderPubKey.substring(0, 16) + "...",
    };

    // Call user handler
    let responseText = "Message received";
    let responseData: Record<string, unknown> | undefined;

    try {
      const handlerResponse = await this.config.onMessage(incomingMessage, senderInfo);
      responseText = handlerResponse.text;
      responseData = handlerResponse.data;
    } catch (err) {
      this.logger.error(`Handler error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Build response
    const taskId = generateTaskId();
    const responseParts: Array<TextPart | DataPart> = [{ kind: "text", text: responseText }];
    if (responseData) {
      responseParts.push({ kind: "data", data: responseData });
    }

    const result: MessageSendResult = {
      task: {
        id: taskId,
        status: { state: "completed" },
      },
      message: {
        role: "agent",
        parts: responseParts,
      },
    };

    const jsonRpcResponse = {
      jsonrpc: "2.0",
      result,
      id: jsonRpcRequest.id,
    };

    // Encrypt response
    const senderPubKeyBuf = hexToPublicKey(senderPubKey);
    const encrypted = encryptMessage(JSON.stringify(jsonRpcResponse), this.config.keypair, senderPubKeyBuf);

    // Create Nostr event
    const event = createNostrEvent({
      pubkey: this.identity,
      kind: 4,
      content: JSON.stringify(encrypted),
      tags: [["p", senderPubKey], ["t", senderPubKey]],
      privateKey: this.config.keypair.privateKey,
    });

    // Publish response to all relays
    for (const client of this.clients) {
      if (client.isConnected()) {
        client.publish(event).catch((err) => {
          this.logger.error(`Failed to publish response: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    this.logger.info(`Received message from ${senderInfo.name}: "${textPart.text.substring(0, 50)}..."`);
  }
}
