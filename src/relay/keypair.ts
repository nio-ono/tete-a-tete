/**
 * Ed25519 Keypair Management for Relay Transport
 */

import { generateKeyPairSync, createPublicKey, createPrivateKey } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export interface Keypair {
  publicKey: Buffer;
  privateKey: Buffer;
}

/**
 * Generate a new Ed25519 keypair
 */
export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  // Extract raw 32-byte keys from DER encoding
  const pubKeyObj = createPublicKey({ key: publicKey, format: "der", type: "spki" });
  const privKeyObj = createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });

  const pubKeyRaw = pubKeyObj.export({ type: "spki", format: "der" });
  const privKeyRaw = privKeyObj.export({ type: "pkcs8", format: "der" });

  // Ed25519 public key is last 32 bytes of SPKI DER
  // Ed25519 private key is at offset 16, 32 bytes in PKCS8 DER
  const publicKeyBuf = Buffer.from(pubKeyRaw.subarray(pubKeyRaw.length - 32));
  const privateKeyBuf = Buffer.from(privKeyRaw.subarray(16, 48));

  return {
    publicKey: publicKeyBuf,
    privateKey: privateKeyBuf,
  };
}

/**
 * Convert public key to hex string (identity)
 */
export function publicKeyToHex(publicKey: Buffer): string {
  return publicKey.toString("hex");
}

/**
 * Convert hex string to public key buffer
 */
export function hexToPublicKey(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Save keypair to file
 */
export async function saveKeypair(keypair: Keypair, filePath: string): Promise<void> {
  const data = {
    publicKey: keypair.publicKey.toString("hex"),
    privateKey: keypair.privateKey.toString("hex"),
  };

  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Load keypair from file
 */
export async function loadKeypair(filePath: string): Promise<Keypair> {
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw);

  return {
    publicKey: Buffer.from(data.publicKey, "hex"),
    privateKey: Buffer.from(data.privateKey, "hex"),
  };
}

/**
 * Load or generate keypair
 */
export async function loadOrGenerateKeypair(filePath: string): Promise<Keypair> {
  if (existsSync(filePath)) {
    return await loadKeypair(filePath);
  }

  const keypair = generateKeypair();
  await saveKeypair(keypair, filePath);
  return keypair;
}
