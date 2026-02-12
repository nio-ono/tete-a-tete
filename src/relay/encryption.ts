/**
 * Message Encryption and Signing for Relay Transport
 * Uses NaCl-style box encryption with Ed25519 keys
 */

import {
  createSign,
  createVerify,
  diffieHellman,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  KeyObject,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import type { Keypair } from "./keypair.js";

/**
 * Encrypted message envelope
 */
export interface EncryptedMessage {
  /** Base64-encoded encrypted data */
  ciphertext: string;
  /** Base64-encoded nonce */
  nonce: string;
  /** Sender's public key (hex) */
  senderPubKey: string;
  /** Base64-encoded signature */
  signature: string;
}

/**
 * Convert Ed25519 private key to X25519 for encryption
 */
function ed25519PrivateToX25519(ed25519Private: Buffer): KeyObject {
  // Create Ed25519 private key object
  const privateKeyDer = Buffer.concat([
    Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]),
    ed25519Private,
  ]);

  const edKey = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });

  // Export as JWK and convert to X25519
  const jwk = edKey.export({ format: "jwk" });
  const x25519Private = Buffer.from(jwk.d as string, "base64url");

  // Create X25519 private key
  const x25519Der = Buffer.concat([
    Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
    ]),
    x25519Private,
  ]);

  return createPrivateKey({ key: x25519Der, format: "der", type: "pkcs8" });
}

/**
 * Convert Ed25519 public key to X25519 for encryption
 */
function ed25519PublicToX25519(ed25519Public: Buffer): KeyObject {
  // Create Ed25519 public key object
  const publicKeyDer = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    ed25519Public,
  ]);

  const edKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });

  // Export as JWK and convert to X25519
  const jwk = edKey.export({ format: "jwk" });
  const x25519Public = Buffer.from(jwk.x as string, "base64url");

  // Create X25519 public key
  const x25519Der = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]),
    x25519Public,
  ]);

  return createPublicKey({ key: x25519Der, format: "der", type: "spki" });
}

/**
 * Derive shared secret using ECDH (X25519)
 */
function deriveSharedSecret(ourPrivate: Buffer, theirPublic: Buffer): Buffer {
  const ourX25519 = ed25519PrivateToX25519(ourPrivate);
  const theirX25519 = ed25519PublicToX25519(theirPublic);

  const sharedSecret = diffieHellman({
    privateKey: ourX25519,
    publicKey: theirX25519,
  });

  return sharedSecret;
}

/**
 * Sign data with Ed25519 private key
 */
function sign(data: Buffer, privateKey: Buffer): Buffer {
  const privateKeyDer = Buffer.concat([
    Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]),
    privateKey,
  ]);

  const key = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const signer = createSign(null as any);
  signer.update(data);
  return signer.sign(key);
}

/**
 * Verify signature with Ed25519 public key
 */
function verify(data: Buffer, signature: Buffer, publicKey: Buffer): boolean {
  const publicKeyDer = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    publicKey,
  ]);

  const key = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  const verifier = createVerify(null as any);
  verifier.update(data);
  return verifier.verify(key, signature);
}

/**
 * Encrypt and sign a message for a recipient
 */
export function encryptMessage(
  plaintext: string,
  senderKeypair: Keypair,
  recipientPublicKey: Buffer
): EncryptedMessage {
  // Derive shared secret
  const sharedSecret = deriveSharedSecret(senderKeypair.privateKey, recipientPublicKey);

  // Generate nonce
  const nonce = randomBytes(24);

  // Encrypt with ChaCha20-Poly1305
  const cipher = createCipheriv("chacha20-poly1305", sharedSecret.subarray(0, 32), nonce.subarray(0, 12), {
    authTagLength: 16,
  });

  const plaintextBuf = Buffer.from(plaintext, "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);

  // Sign the ciphertext
  const signature = sign(ciphertext, senderKeypair.privateKey);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    senderPubKey: senderKeypair.publicKey.toString("hex"),
    signature: signature.toString("base64"),
  };
}

/**
 * Decrypt and verify a message from a sender
 */
export function decryptMessage(
  encrypted: EncryptedMessage,
  recipientKeypair: Keypair
): { success: true; plaintext: string } | { success: false; error: string } {
  try {
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    const nonce = Buffer.from(encrypted.nonce, "base64");
    const senderPubKey = Buffer.from(encrypted.senderPubKey, "hex");
    const signature = Buffer.from(encrypted.signature, "base64");

    // Verify signature
    if (!verify(ciphertext, signature, senderPubKey)) {
      return { success: false, error: "Invalid signature" };
    }

    // Derive shared secret
    const sharedSecret = deriveSharedSecret(recipientKeypair.privateKey, senderPubKey);

    // Decrypt with ChaCha20-Poly1305
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const encryptedData = ciphertext.subarray(0, ciphertext.length - 16);

    const decipher = createDecipheriv(
      "chacha20-poly1305",
      sharedSecret.subarray(0, 32),
      nonce.subarray(0, 12),
      {
        authTagLength: 16,
      }
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    const plaintext = decrypted.toString("utf8");

    return { success: true, plaintext };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Decryption failed" };
  }
}
