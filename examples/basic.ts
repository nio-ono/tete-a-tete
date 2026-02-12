/**
 * Basic example: Echo server and client
 * 
 * Run with: npx tsx examples/basic.ts
 */

import { A2AServer, A2AClient } from "../src/index.js";

const SECRET = "demo-secret-123";
const PORT = 18799;

async function main() {
  // Create and start server
  const server = new A2AServer({
    card: {
      name: "EchoAgent",
      description: "Echoes back whatever you send",
    },
    onMessage: async (msg, sender) => {
      console.log(`[Server] Received from ${sender.name}: ${msg.text}`);
      return {
        text: `Echo: ${msg.text}`,
        data: msg.data ? { echoed: msg.data } : undefined,
      };
    },
    secret: SECRET,
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`[Server] Running on port ${PORT}\n`);

  // Create client and send messages
  const client = new A2AClient();

  // Test 1: Simple text message
  console.log("[Client] Sending simple message...");
  const result1 = await client.send({
    url: `http://localhost:${PORT}/a2a`,
    message: { text: "Hello, world!" },
    secret: SECRET,
    senderName: "TestClient",
  });
  console.log("[Client] Response:", result1);

  // Test 2: Message with data
  console.log("\n[Client] Sending message with data...");
  const result2 = await client.send({
    url: `http://localhost:${PORT}/a2a`,
    message: {
      text: "Process this",
      data: { userId: 123, action: "greet" },
    },
    secret: SECRET,
    senderName: "TestClient",
  });
  console.log("[Client] Response:", result2);

  // Test 3: Fetch agent card
  console.log("\n[Client] Fetching agent card...");
  const cardResult = await client.fetchAgentCard(`http://localhost:${PORT}`);
  console.log("[Client] Agent Card:", cardResult);

  // Test 4: Wrong secret (should fail)
  console.log("\n[Client] Sending with wrong secret...");
  const result3 = await client.send({
    url: `http://localhost:${PORT}/a2a`,
    message: { text: "This should fail" },
    secret: "wrong-secret",
    senderName: "BadClient",
  });
  console.log("[Client] Response:", result3);

  // Clean up
  await server.close();
  console.log("\n[Done] Server stopped");
}

main().catch(console.error);
