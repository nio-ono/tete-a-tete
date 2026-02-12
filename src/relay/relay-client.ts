/**
 * Nostr Relay Client (NIP-01)
 * Simple WebSocket client for publishing and subscribing to messages
 */

import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { schnorr } from "@noble/secp256k1";

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
function hexToBytes(hex: string): Uint8Array {
  return Buffer.from(hex, "hex");
}

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
 * Derive a secp256k1 private key from an Ed25519 private key.
 * Uses SHA256 of the Ed25519 key as the secp256k1 key material.
 */
function deriveSecp256k1Key(ed25519Private: Buffer): Uint8Array {
  return createHash("sha256").update(ed25519Private).update(Buffer.from("ttt-nostr-key")).digest();
}

/**
 * Get the Nostr pubkey (x-only secp256k1) for a given Ed25519 private key
 */
export function getNostrPubkey(ed25519Private: Buffer): string {
  const secpPriv = deriveSecp256k1Key(ed25519Private);
  return bytesToHex(schnorr.getPublicKey(secpPriv));
}

/**
 * Create a signed Nostr event (NIP-01 compliant)
 */
export function createNostrEvent(params: {
  pubkey: string;
  kind: number;
  content: string;
  tags?: string[][];
  privateKey: Buffer;
}): NostrEvent {
  const secpPriv = deriveSecp256k1Key(params.privateKey);
  const nostrPubkey = bytesToHex(schnorr.getPublicKey(secpPriv));

  const event = {
    pubkey: nostrPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: params.kind,
    tags: params.tags || [],
    content: params.content,
  };

  // NIP-01: event ID = SHA256 of [0, pubkey, created_at, kind, tags, content]
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const id = createHash("sha256").update(serialized).digest("hex");

  // BIP-340 Schnorr signature
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secpPriv));

  return {
    id,
    sig,
    ...event,
  };
}
