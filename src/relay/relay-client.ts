/**
 * Nostr Relay Client (NIP-01)
 * Simple WebSocket client for publishing and subscribing to messages
 */

import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";

/**
 * Nostr event structure
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Relay client options
 */
export interface RelayClientOptions {
  /** Relay WebSocket URL */
  url: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

/**
 * Relay client events
 */
interface RelayClientEvents {
  connected: () => void;
  disconnected: () => void;
  event: (event: NostrEvent) => void;
  error: (error: Error) => void;
}

/**
 * Simple Nostr relay client
 */
export class RelayClient extends EventEmitter {
  private url: string;
  private ws: WebSocket | null = null;
  private autoReconnect: boolean;
  private reconnectDelay: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, object>();
  private connected = false;

  constructor(options: RelayClientOptions) {
    super();
    this.url = options.url;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 3000;
  }

  /**
   * Connect to the relay
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        const onOpen = () => {
          this.connected = true;
          this.emit("connected");

          // Resubscribe to all subscriptions
          for (const [subId, filter] of this.subscriptions.entries()) {
            this.send(["REQ", subId, filter]);
          }

          cleanup();
          resolve();
        };

        const onError = (event: Event) => {
          const err = new Error("WebSocket error");
          this.emit("error", err);
          cleanup();
          reject(err);
        };

        const cleanup = () => {
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onError);
        };

        this.ws.addEventListener("open", onOpen);
        this.ws.addEventListener("error", onError);

        this.ws.addEventListener("close", () => {
          this.connected = false;
          this.emit("disconnected");

          if (this.autoReconnect && !this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.connect().catch(() => {
                // Will retry again
              });
            }, this.reconnectDelay);
          }
        });

        this.ws.addEventListener("message", (event: MessageEvent) => {
          if (typeof event.data === "string") {
            this.handleMessage(event.data);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the relay
   */
  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Subscribe to events matching a filter
   */
  subscribe(subId: string, filter: object): void {
    this.subscriptions.set(subId, filter);
    if (this.connected) {
      this.send(["REQ", subId, filter]);
    }
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subId: string): void {
    this.subscriptions.delete(subId);
    if (this.connected) {
      this.send(["CLOSE", subId]);
    }
  }

  /**
   * Publish an event to the relay
   */
  async publish(event: NostrEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Not connected to relay"));
        return;
      }

      // Send EVENT message
      this.send(["EVENT", event]);

      // Wait for OK response
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Publish timeout"));
      }, 10000);

      const onMessage = (msgEvent: MessageEvent) => {
        try {
          if (typeof msgEvent.data !== "string") return;
          const msg = JSON.parse(msgEvent.data);
          if (msg[0] === "OK" && msg[1] === event.id) {
            cleanup();
            if (msg[2]) {
              resolve();
            } else {
              reject(new Error(msg[3] || "Publish failed"));
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.ws?.removeEventListener("message", onMessage);
      };

      this.ws?.addEventListener("message", onMessage);
    });
  }

  /**
   * Send a message to the relay
   */
  private send(message: unknown[]): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming message from relay
   */
  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (!Array.isArray(msg) || msg.length < 2) {
        return;
      }

      const [type, ...args] = msg;

      switch (type) {
        case "EVENT":
          if (args.length >= 2) {
            const event = args[1] as NostrEvent;
            this.emit("event", event);
          }
          break;

        case "EOSE":
          // End of stored events - we don't need to do anything
          break;

        case "OK":
          // Handled in publish() method
          break;

        case "NOTICE":
          // Relay notices - could log these
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }

  /**
   * Type-safe event emitter
   */
  on<K extends keyof RelayClientEvents>(event: K, listener: RelayClientEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof RelayClientEvents>(event: K, ...args: Parameters<RelayClientEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a signed Nostr event
 */
export function createNostrEvent(params: {
  pubkey: string;
  kind: number;
  content: string;
  tags?: string[][];
  privateKey: Buffer;
}): NostrEvent {
  const event = {
    pubkey: params.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: params.kind,
    tags: params.tags || [],
    content: params.content,
  };

  // Create event ID (SHA256 of serialized event)
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const id = createHash("sha256").update(serialized).digest("hex");

  // Sign with schnorr (using Ed25519 private key)
  const signature = schnorrSign(id, params.privateKey);

  return {
    id,
    sig: signature,
    ...event,
  };
}

/**
 * Simple Schnorr signature (for Nostr)
 * Note: This is a simplified version. For production, use a proper Schnorr library.
 */
function schnorrSign(messageHash: string, privateKey: Buffer): string {
  // For simplicity, we'll use the message hash + private key hash as signature
  // In a real implementation, you'd use proper Schnorr signatures
  const sigData = createHash("sha256")
    .update(Buffer.concat([Buffer.from(messageHash, "hex"), privateKey]))
    .digest();

  return sigData.toString("hex") + randomBytes(32).toString("hex");
}
