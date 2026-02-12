#!/usr/bin/env node
/**
 * tête-à-tête CLI - Standalone relay-based agent communication
 */

import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { RelayTransport } from "./relay/relay-transport.js";
import {
  loadOrGenerateKeypair,
  publicKeyToHex,
  type Keypair,
} from "./relay/keypair.js";

// Default relays
const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

// Default keypair path
const DEFAULT_KEYPAIR_PATH = join(homedir(), ".openclaw", "ttt-keypair.json");

interface ParsedArgs {
  command: string;
  args: string[];
  keypair: string;
  relays: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let keypair = DEFAULT_KEYPAIR_PATH;
  const relays: string[] = [];
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--keypair" && i + 1 < args.length) {
      keypair = args[i + 1];
      i += 2;
    } else if (arg === "--relay" && i + 1 < args.length) {
      relays.push(args[i + 1]);
      i += 2;
    } else if (arg === "-h" || arg === "--help") {
      positional.push("help");
      i++;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
      i++;
    } else {
      i++;
    }
  }

  return {
    command: positional[0] || "help",
    args: positional.slice(1),
    keypair,
    relays: relays.length > 0 ? relays : DEFAULT_RELAYS,
  };
}

function printUsage(): void {
  console.log(`
tête-à-tête CLI - Agent-to-agent communication over Nostr relays

Usage: ttt <command> [options]

Commands:
  identity              Print your public key (generates keypair if needed)
  chat <pubkey>         Interactive chat with another agent
  send <pubkey> <msg>   Send a one-shot message
  ping <pubkey>         Ping another agent, measure RTT

Options:
  --keypair <path>      Path to keypair file (default: ~/.openclaw/ttt-keypair.json)
  --relay <url>         Relay URL (repeatable, default: damus.io + nos.lol)
  -h, --help            Show this help

Examples:
  ttt identity
  ttt chat abc123def456...
  ttt send abc123def456... "Hello, world!"
  ttt ping abc123def456...
  ttt --relay wss://custom.relay.com chat abc123...
`);
}

async function cmdIdentity(keypairPath: string): Promise<void> {
  const keypair = await loadOrGenerateKeypair(keypairPath);
  const pubkey = publicKeyToHex(keypair.publicKey);
  console.log(`Public key: ${pubkey}`);
  console.log(`Keypair stored at: ${keypairPath}`);
}

async function cmdPing(
  pubkey: string,
  keypairPath: string,
  relays: string[]
): Promise<void> {
  const keypair = await loadOrGenerateKeypair(keypairPath);
  const myPubkey = publicKeyToHex(keypair.publicKey);

  console.log(`Your pubkey: ${myPubkey}`);
  console.log(`Pinging: ${pubkey}`);
  console.log(`Relays: ${relays.join(", ")}`);

  const transport = new RelayTransport({
    keypair,
    relays,
    agentName: "ttt-cli",
    onMessage: async () => ({ text: "pong" }),
    logger: {
      info: () => {},
      warn: () => {},
      error: (msg) => console.error(`[error] ${msg}`),
    },
  });

  await transport.connect();

  const start = Date.now();
  const result = await transport.send(
    {
      recipientPubKey: pubkey,
      text: "ping",
      senderName: "ttt-cli",
    },
    10000
  );

  const rtt = Date.now() - start;

  await transport.disconnect();

  if (result.success) {
    console.log(`Pong received! RTT: ${rtt}ms`);
    if (result.response) {
      console.log(`Response: ${result.response}`);
    }
  } else {
    console.error(`Ping failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdSend(
  pubkey: string,
  message: string,
  keypairPath: string,
  relays: string[]
): Promise<void> {
  const keypair = await loadOrGenerateKeypair(keypairPath);
  const myPubkey = publicKeyToHex(keypair.publicKey);

  console.log(`Your pubkey: ${myPubkey}`);
  console.log(`Sending to: ${pubkey}`);

  const transport = new RelayTransport({
    keypair,
    relays,
    agentName: "ttt-cli",
    onMessage: async () => ({ text: "ack" }),
    logger: {
      info: () => {},
      warn: () => {},
      error: (msg) => console.error(`[error] ${msg}`),
    },
  });

  await transport.connect();

  const result = await transport.send(
    {
      recipientPubKey: pubkey,
      text: message,
      senderName: "ttt-cli",
    },
    30000
  );

  await transport.disconnect();

  if (result.success) {
    console.log(`✓ Message sent`);
    if (result.response) {
      console.log(`Response: ${result.response}`);
    }
  } else {
    console.error(`✗ Send failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdChat(
  pubkey: string,
  keypairPath: string,
  relays: string[]
): Promise<void> {
  const keypair = await loadOrGenerateKeypair(keypairPath);
  const myPubkey = publicKeyToHex(keypair.publicKey);

  console.log(`Your pubkey: ${myPubkey}`);
  console.log(`Chatting with: ${pubkey}`);
  console.log(`Relays: ${relays.join(", ")}`);
  console.log(`Type messages and press Enter. Ctrl+C to exit.\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const transport = new RelayTransport({
    keypair,
    relays,
    agentName: "ttt-cli",
    onMessage: async (msg, sender) => {
      // Print incoming message inline (clear current line first)
      process.stdout.write("\r\x1b[K"); // Clear line
      console.log(`\x1b[36m${sender.name}:\x1b[0m ${msg.text}`);
      rl.prompt(true);
      return { text: "received" };
    },
    logger: {
      info: (msg) => {
        if (msg.includes("Connected")) {
          console.log(`\x1b[32m✓\x1b[0m ${msg}`);
        }
      },
      warn: (msg) => console.warn(`\x1b[33m!\x1b[0m ${msg}`),
      error: (msg) => console.error(`\x1b[31m✗\x1b[0m ${msg}`),
    },
  });

  await transport.connect();

  rl.setPrompt("\x1b[90myou>\x1b[0m ");
  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    const result = await transport.send({
      recipientPubKey: pubkey,
      text,
      senderName: "ttt-cli",
    });

    if (result.success && result.response) {
      console.log(`\x1b[36mthem:\x1b[0m ${result.response}`);
    } else if (!result.success) {
      console.log(`\x1b[31m✗ ${result.error}\x1b[0m`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("\nDisconnecting...");
    await transport.disconnect();
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    rl.close();
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  try {
    switch (parsed.command) {
      case "help":
        printUsage();
        break;

      case "identity":
        await cmdIdentity(parsed.keypair);
        break;

      case "ping":
        if (!parsed.args[0]) {
          console.error("Error: pubkey required");
          console.error("Usage: ttt ping <pubkey>");
          process.exit(1);
        }
        await cmdPing(parsed.args[0], parsed.keypair, parsed.relays);
        break;

      case "send":
        if (!parsed.args[0] || !parsed.args[1]) {
          console.error("Error: pubkey and message required");
          console.error('Usage: ttt send <pubkey> "message"');
          process.exit(1);
        }
        await cmdSend(
          parsed.args[0],
          parsed.args.slice(1).join(" "),
          parsed.keypair,
          parsed.relays
        );
        break;

      case "chat":
        if (!parsed.args[0]) {
          console.error("Error: pubkey required");
          console.error("Usage: ttt chat <pubkey>");
          process.exit(1);
        }
        await cmdChat(parsed.args[0], parsed.keypair, parsed.relays);
        break;

      default:
        console.error(`Unknown command: ${parsed.command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

main();
