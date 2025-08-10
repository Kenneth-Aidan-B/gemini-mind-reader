import type { Server as HttpServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebSocketServer, WebSocket } from "ws";
import { GameManager } from "./game";
import { AnswerSchema } from "./types";
import { z } from "zod";

// Better WebSocket Transport for MCP that properly handles the protocol
class WebSocketTransport {
  private ws: WebSocket;
  private messageHandler?: (message: any) => void;
  private closeHandler?: () => void;
  private errorHandler?: (error: Error) => void;

  constructor(ws: WebSocket) {
    this.ws = ws;
    
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received MCP message:', JSON.stringify(message, null, 2));
        if (this.messageHandler) {
          this.messageHandler(message);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        if (this.errorHandler) {
          this.errorHandler(error as Error);
        }
      }
    });

    this.ws.on('close', () => {
      console.log('WebSocket connection closed');
      if (this.closeHandler) {
        this.closeHandler();
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (this.errorHandler) {
        this.errorHandler(error);
      }
    });
  }

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: any): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      console.log('Sending MCP message:', JSON.stringify(message, null, 2));
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket is not open');
    }
  }

  async close(): Promise<void> {
    this.ws.close();
  }

  onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
}

export function attachMCP(server: HttpServer, path: string, game: GameManager, tools: {
  start: () => Promise<{ sessionId: string; question: string }>;
  answer: (sessionId: string, answer: "yes" | "no" | "maybe" | "unknown") => Promise<{ question?: string; guess?: string; done: boolean }>;
  getGuess: (sessionId: string) => Promise<{ guess: string | null }>;
  end: (sessionId: string, outcome: "ai_won" | "user_won", actualAnswer?: string) => Promise<{ ended: true }>;
}) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    if (request.url === path) {
      // Check for bearer token in Authorization header
      const authHeader = request.headers.authorization;
      const expectedToken = process.env.MCP_BEARER_TOKEN || "gemini-mind-reader-token-2025";
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      if (token !== expectedToken) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, async (ws) => {
        console.log("WebSocket connection established");
        
        // Create MCP server for this connection
        const mcpServer = new McpServer({
          name: "gemini-mind-reader",
          version: "1.0.0",
        });

        // Register tools
        setupMCPTools(mcpServer, tools);

        // Handle WebSocket messages manually
        ws.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log('Received message:', JSON.stringify(message, null, 2));
            
            // Handle initialization
            if (message.method === 'initialize') {
              const response = {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  protocolVersion: "2024-11-05",
                  capabilities: {
                    tools: {},
                    logging: {}
                  },
                  serverInfo: {
                    name: "gemini-mind-reader",
                    version: "1.0.0"
                  }
                }
              };
              ws.send(JSON.stringify(response));
              return;
            }

            // Handle tool calls
            if (message.method === 'tools/call') {
              await handleToolCall(message, ws, tools);
              return;
            }

            // Handle tools/list
            if (message.method === 'tools/list') {
              const response = {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  tools: [
                    {
                      name: "validate",
                      description: "Validate user's phone number - returns number in {country_code}{number} format",
                      inputSchema: {
                        type: "object",
                        properties: {
                          phoneNumber: { type: "string", description: "User's phone number" }
                        },
                        required: ["phoneNumber"]
                      }
                    },
                    {
                      name: "start_game",
                      description: "Start a new game session and receive the first AI question",
                      inputSchema: {
                        type: "object",
                        properties: {}
                      }
                    },
                    {
                      name: "answer_question", 
                      description: "Answer the AI's question with yes, no, maybe, or unknown",
                      inputSchema: {
                        type: "object",
                        properties: {
                          sessionId: { type: "string", description: "Session ID from start_game" },
                          answer: { type: "string", enum: ["yes", "no", "maybe", "unknown"], description: "Your answer" }
                        },
                        required: ["sessionId", "answer"]
                      }
                    },
                    {
                      name: "get_guess",
                      description: "Get the AI's current best guess",
                      inputSchema: {
                        type: "object", 
                        properties: {
                          sessionId: { type: "string", description: "Session ID from start_game" }
                        },
                        required: ["sessionId"]
                      }
                    },
                    {
                      name: "end_game",
                      description: "End the game with the outcome and optionally the actual answer",
                      inputSchema: {
                        type: "object",
                        properties: {
                          sessionId: { type: "string", description: "Session ID from start_game" },
                          outcome: { type: "string", enum: ["ai_won", "user_won"], description: "Game outcome" },
                          actualAnswer: { type: "string", description: "The actual answer if user won" }
                        },
                        required: ["sessionId", "outcome"]
                      }
                    }
                  ]
                }
              };
              ws.send(JSON.stringify(response));
              return;
            }

          } catch (error) {
            console.error('Error handling WebSocket message:', error);
            const errorResponse = {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32603,
                message: "Internal error"
              }
            };
            ws.send(JSON.stringify(errorResponse));
          }
        });

        ws.on('close', () => {
          console.log("WebSocket connection closed");
        });

        ws.on('error', (error) => {
          console.error("WebSocket error:", error);
        });
      });
    }
  });
}

async function handleToolCall(message: any, ws: WebSocket, tools: any) {
  try {
    const { name, arguments: args } = message.params;
    
    let result;
    
    switch (name) {
      case 'validate':
        result = await handleValidate(args.phoneNumber);
        break;
      case 'start_game':
        result = await tools.start();
        break;
      case 'answer_question':
        result = await tools.answer(args.sessionId, args.answer);
        break;
      case 'get_guess':
        result = await tools.getGuess(args.sessionId);
        break;
      case 'end_game':
        result = await tools.end(args.sessionId, args.outcome, args.actualAnswer);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const response = {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      }
    };
    
    ws.send(JSON.stringify(response));
  } catch (error) {
    console.error('Tool call error:', error);
    const errorResponse = {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Tool execution failed"
      }
    };
    ws.send(JSON.stringify(errorResponse));
  }
}

async function handleValidate(phoneNumber: string) {
  let countryCode = "";
  let number = phoneNumber.replace(/\D/g, "");
  
  if (number.startsWith("1") && number.length === 11) {
    countryCode = "1";
    number = number.substring(1);
  } else if (number.startsWith("91") && number.length === 12) {
    countryCode = "91";
    number = number.substring(2);
  } else if (number.startsWith("234") && number.length === 13) {
    countryCode = "234";
    number = number.substring(3);
  } else if (number.startsWith("44") && number.length >= 12) {
    countryCode = "44";
    number = number.substring(2);
  } else if (number.length === 10) {
    countryCode = "91";
  } else if (number.length === 11 && number.startsWith("0")) {
    countryCode = "91";
    number = number.substring(1);
  } else {
    if (number.length >= 10) {
      countryCode = number.substring(0, number.length - 10);
      number = number.substring(number.length - 10);
    }
  }
  
  const formattedNumber = `{${countryCode}}{${number}}`;
  
  return {
    validated_number: formattedNumber,
    original_input: phoneNumber,
    country_code: countryCode,
    local_number: number
  };
}

function setupMCPTools(mcpServer: McpServer, tools: any) {
  // This function is kept for future use if needed
}
