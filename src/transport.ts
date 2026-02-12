/**
 * HTTP Transport Layer for A2A Protocol
 */

import type { IncomingMessage as HttpRequest, ServerResponse } from "node:http";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcError } from "./types.js";
import { JSON_RPC_ERRORS } from "./types.js";

/**
 * Read and parse JSON body from HTTP request
 */
export async function readJsonBody<T = unknown>(
  req: HttpRequest,
  maxBytes: number = 1024 * 1024
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          reject(new Error("Empty payload"));
          return;
        }
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

/**
 * Send JSON response
 */
export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Send JSON-RPC error response
 */
export function sendJsonRpcError(
  res: ServerResponse,
  id: string | number | null,
  code: number,
  message: string
): void {
  const error: JsonRpcError = { code, message };
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    error,
    id,
  };

  // Use 400 for parse/invalid request errors, 200 for method-level errors
  const httpStatus = code === JSON_RPC_ERRORS.PARSE_ERROR || code === JSON_RPC_ERRORS.INVALID_REQUEST ? 400 : 200;
  sendJson(res, httpStatus, response);
}

/**
 * Send JSON-RPC success response
 */
export function sendJsonRpcSuccess(
  res: ServerResponse,
  id: string | number,
  result: unknown
): void {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    result,
    id,
  };
  sendJson(res, 200, response);
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate unique task ID
 */
export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Build A2A JSON-RPC request for message/send
 */
export function buildMessageSendRequest(
  text: string,
  data?: Record<string, unknown>
): JsonRpcRequest {
  const parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }> = [
    { kind: "text", text },
  ];
  
  if (data) {
    parts.push({ kind: "data", data });
  }

  return {
    jsonrpc: "2.0",
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts,
      },
    },
    id: generateMessageId(),
  };
}
