/**
 * A2A Server - HTTP server for receiving A2A messages
 */

import http from "node:http";
import type { IncomingMessage as HttpRequest, ServerResponse, Server } from "node:http";
import type {
  A2AServerConfig,
  AgentCard,
  JsonRpcRequest,
  MessageSendParams,
  MessageSendResult,
  TextPart,
  DataPart,
  IncomingMessage,
  SenderInfo,
  Logger,
} from "./types.js";
import { JSON_RPC_ERRORS } from "./types.js";
import { generateAgentCard } from "./agent-card.js";
import {
  readJsonBody,
  sendJson,
  sendJsonRpcError,
  sendJsonRpcSuccess,
  generateTaskId,
} from "./transport.js";

const defaultLogger: Logger = {
  info: (msg) => console.log(`[tete-a-tete] ${msg}`),
  warn: (msg) => console.warn(`[tete-a-tete] ${msg}`),
  error: (msg) => console.error(`[tete-a-tete] ${msg}`),
};

/**
 * A2A Server for receiving messages from other agents
 * 
 * @example
 * ```typescript
 * const server = new A2AServer({
 *   card: {
 *     name: 'MyAgent',
 *     description: 'A helpful assistant'
 *   },
 *   onMessage: async (msg, sender) => {
 *     console.log(`Received from ${sender.name}: ${msg.text}`);
 *     return { text: 'Got it!' };
 *   },
 *   secret: 'my-shared-secret'
 * });
 * 
 * server.listen(18790);
 * ```
 */
export class A2AServer {
  private config: A2AServerConfig;
  private server: Server | null = null;
  private logger: Logger;
  private agentCard: AgentCard | null = null;
  private baseUrl: string = "";

  constructor(config: A2AServerConfig) {
    this.config = config;
    this.logger = config.logger ?? defaultLogger;
  }

  /**
   * Start the server on the specified port
   */
  listen(port: number, callback?: () => void): void {
    const hostname = this.config.hostname ?? "0.0.0.0";
    this.baseUrl = `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`;

    // Generate agent card
    this.agentCard = generateAgentCard({
      name: this.config.card.name,
      description: this.config.card.description,
      url: `${this.baseUrl}/a2a`,
      skills: this.config.skills,
    });

    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (err) {
        this.logger.error(`Request error: ${err instanceof Error ? err.message : String(err)}`);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });

    this.server.listen(port, hostname, () => {
      this.logger.info(`Server listening on ${hostname}:${port}`);
      this.logger.info(`Agent Card: ${this.baseUrl}/.well-known/agent-card.json`);
      this.logger.info(`A2A endpoint: ${this.baseUrl}/a2a`);
      callback?.();
    });
  }

  /**
   * Stop the server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) reject(err);
        else {
          this.logger.info("Server stopped");
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the generated agent card
   */
  getAgentCard(): AgentCard | null {
    return this.agentCard;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: HttpRequest, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-A2A-Sender");
      res.statusCode = 204;
      res.end();
      return;
    }

    // Add CORS headers to all responses
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Route: GET /.well-known/agent-card.json
    if (url.pathname === "/.well-known/agent-card.json" && req.method === "GET") {
      if (!this.agentCard) {
        res.statusCode = 503;
        res.end("Service unavailable");
        return;
      }
      sendJson(res, 200, this.agentCard);
      return;
    }

    // Route: POST /a2a
    if (url.pathname === "/a2a" && req.method === "POST") {
      await this.handleA2A(req, res);
      return;
    }

    // 404 for everything else
    res.statusCode = 404;
    res.end("Not Found");
  }

  /**
   * Handle A2A JSON-RPC request
   */
  private async handleA2A(req: HttpRequest, res: ServerResponse): Promise<void> {
    // Verify auth
    const authHeader = req.headers.authorization ?? "";
    const expectedToken = `Bearer ${this.config.secret}`;
    if (authHeader !== expectedToken) {
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }

    // Parse request
    let jsonRpcRequest: JsonRpcRequest;
    try {
      jsonRpcRequest = await readJsonBody<JsonRpcRequest>(req);
    } catch (err) {
      sendJsonRpcError(res, null, JSON_RPC_ERRORS.PARSE_ERROR, err instanceof Error ? err.message : "Parse error");
      return;
    }

    // Validate JSON-RPC
    if (jsonRpcRequest.jsonrpc !== "2.0") {
      sendJsonRpcError(res, jsonRpcRequest.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC version");
      return;
    }

    // Handle methods
    switch (jsonRpcRequest.method) {
      case "message/send":
        await this.handleMessageSend(req, res, jsonRpcRequest);
        break;

      default:
        sendJsonRpcError(
          res,
          jsonRpcRequest.id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Method not found: ${jsonRpcRequest.method}`
        );
    }
  }

  /**
   * Handle message/send method
   */
  private async handleMessageSend(
    req: HttpRequest,
    res: ServerResponse,
    jsonRpcRequest: JsonRpcRequest
  ): Promise<void> {
    const params = jsonRpcRequest.params as unknown as MessageSendParams | undefined;

    if (!params?.message) {
      sendJsonRpcError(res, jsonRpcRequest.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Invalid params: message required");
      return;
    }

    const message = params.message;
    const textPart = message.parts.find((p) => p.kind === "text") as TextPart | undefined;
    const dataPart = message.parts.find((p) => p.kind === "data") as DataPart | undefined;

    if (!textPart?.text) {
      sendJsonRpcError(res, jsonRpcRequest.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Invalid params: text part required");
      return;
    }

    // Extract sender info
    const senderHeader = req.headers["x-a2a-sender"] as string | undefined;
    const senderName = senderHeader || "unknown";

    // Prepare message for handler
    const incomingMessage: IncomingMessage = {
      text: textPart.text,
      data: dataPart?.data,
      raw: message,
    };

    const senderInfo: SenderInfo = {
      name: senderName,
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
      // Still acknowledge receipt, but log the error
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

    sendJsonRpcSuccess(res, jsonRpcRequest.id, result);
    this.logger.info(`Received message from ${senderName}: "${textPart.text.substring(0, 50)}..."`);
  }
}

/**
 * Create a new A2A server instance
 */
export function createServer(config: A2AServerConfig): A2AServer {
  return new A2AServer(config);
}
