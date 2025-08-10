import type { Server as HttpServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebSocketServer, WebSocket } from "ws";
import { GameManager } from "./game";
import { AnswerSchema } from "./types";
import { z } from "zod";

// Simple WebSocket Transport for MCP
class WebSocketTransport {
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: any): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    this.ws.close();
  }

  onMessage(handler: (message: any) => void): void {
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handler(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });
  }

  onClose(handler: () => void): void {
    this.ws.on('close', handler);
  }

  onError(handler: (error: Error) => void): void {
    this.ws.on('error', handler);
  }
}

export function attachMCP(server: HttpServer, path: string, game: GameManager, tools: {
  start: () => Promise<{ sessionId: string; question: string }>;
  answer: (sessionId: string, answer: "yes" | "no" | "maybe" | "unknown") => Promise<{ question?: string; guess?: string; done: boolean }>;
  getGuess: (sessionId: string) => Promise<{ guess: string | null }>;
  end: (sessionId: string, outcome: "ai_won" | "user_won", actualAnswer?: string) => Promise<{ ended: true }>;
}) {
  const wss = new WebSocketServer({ noServer: true });

  const mcpServer = new McpServer({ name: "ai-mind-reader", version: "1.0.0" });

  // Tool: start_game
  mcpServer.registerTool("start_game", {
    description: "Start a new game session and receive the first AI question.",
    inputSchema: {},
  }, async () => {
    const res = await tools.start();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res),
        },
      ],
    };
  });

  // Tool: answer_question
  mcpServer.registerTool("answer_question", {
    description: "Answer the AI's question with yes, no, maybe, or unknown.",
    inputSchema: {
      sessionId: z.string().describe("Session ID from start_game"),
      answer: z.enum(["yes", "no", "maybe", "unknown"]).describe("Your answer to the AI's question"),
    },
  }, async ({ sessionId, answer }) => {
    const res = await tools.answer(sessionId, answer);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res),
        },
      ],
    };
  });

  // Tool: get_guess
  mcpServer.registerTool("get_guess", {
    description: "Get the AI's current best guess.",
    inputSchema: {
      sessionId: z.string().describe("Session ID from start_game"),
    },
  }, async ({ sessionId }) => {
    const res = await tools.getGuess(sessionId);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res),
        },
      ],
    };
  });

  // Tool: end_game
  mcpServer.registerTool("end_game", {
    description: "End the game with the outcome and optionally the actual answer.",
    inputSchema: {
      sessionId: z.string().describe("Session ID from start_game"),
      outcome: z.enum(["ai_won", "user_won"]).describe("Game outcome"),
      actualAnswer: z.string().optional().describe("The actual answer if user won"),
    },
  }, async ({ sessionId, outcome, actualAnswer }) => {
    const res = await tools.end(sessionId, outcome, actualAnswer);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res),
        },
      ],
    };
  });

  // Required tool: validate - Returns user's number in {country_code}{number} format
  mcpServer.registerTool("validate", {
    description: "Validate user's phone number - returns number in {country_code}{number} format",
    inputSchema: {
      phoneNumber: z.string().describe("User's phone number"),
    },
  }, async ({ phoneNumber }) => {
    // Extract country code and number
    let countryCode = "";
    let number = phoneNumber.replace(/\D/g, ""); // Remove non-digits
    
    if (number.startsWith("1") && number.length === 11) {
      // US/Canada
      countryCode = "1";
      number = number.substring(1);
    } else if (number.startsWith("91") && number.length === 12) {
      // India - 91 + 10 digit number
      countryCode = "91";
      number = number.substring(2);
    } else if (number.startsWith("234") && number.length === 13) {
      // Nigeria
      countryCode = "234";
      number = number.substring(3);
    } else if (number.startsWith("44") && number.length >= 12) {
      // UK
      countryCode = "44";
      number = number.substring(2);
    } else if (number.length === 10) {
      // If 10 digits and no country code, assume India for this user
      countryCode = "91";
    } else if (number.length === 11 && number.startsWith("0")) {
      // Indian number with leading 0, remove it
      countryCode = "91";
      number = number.substring(1);
    } else {
      // Default - use first 1-3 digits as country code
      if (number.length >= 10) {
        countryCode = number.substring(0, number.length - 10);
        number = number.substring(number.length - 10);
      }
    }
    
    const formattedNumber = `{${countryCode}}{${number}}`;
    
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ 
            validated_number: formattedNumber,
            original_input: phoneNumber,
            country_code: countryCode,
            local_number: number
          }),
        },
      ],
    };
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    if (request.url === path) {
      wss.handleUpgrade(request, socket, head, async (ws) => {
        // Create a custom transport for WebSocket
        const transport = new WebSocketTransport(ws);
        
        try {
          await mcpServer.connect(transport);
        } catch (error) {
          console.error("MCP connection error:", error);
          ws.close();
        }
      });
    }
  });
}
