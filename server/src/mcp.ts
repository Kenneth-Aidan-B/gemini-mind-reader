import type { Server as HttpServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { GameManager } from "./game";
import { AnswerSchema } from "./types";
import { z } from "zod";

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

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    if (request.url === path) {
      wss.handleUpgrade(request, socket, head, async (ws) => {
        // Create a custom transport for WebSocket
        const transport = new StdioServerTransport(
          ws as any, // WebSocket as readable/writable stream
          ws as any
        );
        
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
