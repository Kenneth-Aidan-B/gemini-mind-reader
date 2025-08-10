import type { Server as HttpServer } from "http";
import { Server as MCPServer } from "@modelcontextprotocol/sdk/server";
// The websocket transport path may vary across versions; this is the current documented import.
import { WebSocketServerTransport } from "@modelcontextprotocol/sdk/server/websocket";
import { WebSocketServer } from "ws";
import { GameManager } from "./game";
import { AnswerSchema } from "./types";

export function attachMCP(server: HttpServer, path: string, game: GameManager, tools: {
  start: () => Promise<{ sessionId: string; question: string }>;
  answer: (sessionId: string, answer: "yes" | "no" | "maybe" | "unknown") => Promise<{ question?: string; guess?: string; done: boolean }>;
  getGuess: (sessionId: string) => Promise<{ guess: string | null }>;
  end: (sessionId: string, outcome: "ai_won" | "user_won", actualAnswer?: string) => Promise<{ ended: true }>;
}) {
  const wss = new WebSocketServer({ noServer: true });

  const mcp = new MCPServer({ name: "ai-mind-reader", version: "1.0.0" }, {
    capabilities: {
      tools: {},
    },
  });

  // Tool: start_game
  mcp.tool(
    "start_game",
    {
      description: "Start a new game session and receive the first AI question.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async () => {
      const res = await tools.start();
      return res;
    }
  );

  // Tool: answer_question
  mcp.tool(
    "answer_question",
    {
      description: "Submit an answer to the last AI question (yes/no/maybe/unknown)",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          answer: { type: "string", enum: ["yes", "no", "maybe", "unknown"] },
        },
        required: ["sessionId", "answer"],
        additionalProperties: false,
      },
    },
    async (args: any) => {
      const res = await tools.answer(args.sessionId, args.answer);
      return res;
    }
  );

  // Tool: get_guess
  mcp.tool(
    "get_guess",
    {
      description: "Retrieve the AI's current best guess for the session.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" } },
        required: ["sessionId"],
        additionalProperties: false,
      },
    },
    async (args: any) => tools.getGuess(args.sessionId)
  );

  // Tool: end_game
  mcp.tool(
    "end_game",
    {
      description: "End the game, optionally providing the correct answer if the user won.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          outcome: { type: "string", enum: ["ai_won", "user_won"] },
          actualAnswer: { type: "string" },
        },
        required: ["sessionId", "outcome"],
        additionalProperties: false,
      },
    },
    async (args: any) => tools.end(args.sessionId, args.outcome, args.actualAnswer)
  );

  // Hook up websocket transport at /mcp
  server.on("upgrade", (request, socket, head) => {
    if (!request.url) return;
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== path) return;
    wss.handleUpgrade(request as any, socket as any, head, (ws) => {
      const transport = new WebSocketServerTransport({ websocket: ws });
      mcp.connect(transport);
    });
  });
}
