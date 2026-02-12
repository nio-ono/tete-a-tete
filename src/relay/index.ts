/**
 * Relay Transport - P2P messaging over Nostr relays
 */

export { RelayTransport } from "./relay-transport.js";
export type { RelayTransportConfig, RelayMessage, RelaySendResult } from "./relay-transport.js";

export {
  generateKeypair,
  publicKeyToHex,
  hexToPublicKey,
  saveKeypair,
  loadKeypair,
  loadOrGenerateKeypair,
} from "./keypair.js";
export type { Keypair } from "./keypair.js";

export { encryptMessage, decryptMessage } from "./encryption.js";
export type { EncryptedMessage } from "./encryption.js";

export { RelayClient, createNostrEvent } from "./relay-client.js";
export type { NostrEvent, RelayClientOptions } from "./relay-client.js";
