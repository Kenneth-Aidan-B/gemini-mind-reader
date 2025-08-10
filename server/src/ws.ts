import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GameManager } from "./game";
import { AnswerType } from "./types";

export function attachGameWebSocket(server: HttpServer, path: string, game: GameManager, handlers: {
  nextStep: (sessionId: string) => Promise<{ question?: string; guess?: string; done: boolean }>;
  finalize: (sessionId: string, outcome: "ai_won" | "user_won", actualAnswer?: string) => Promise<void>;
}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url) return;
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== path) return;

    wss.handleUpgrade(request as any, socket as any, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;

    const send = (msg: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "start": {
            const session = game.createSession();
            sessionId = session.id;
            const step = await handlers.nextStep(session.id);
            if (step.question) {
              send({ type: "question", question: step.question, sessionId: session.id });
            } else if (step.guess) {
              send({ type: "guess", guess: step.guess, sessionId: session.id });
            }
            break;
          }
          case "answer": {
            if (!msg.sessionId || !msg.answer) return;
            sessionId = msg.sessionId;
            const step = await handlers.nextStep(msg.sessionId);
            if (step.question) send({ type: "question", question: step.question });
            if (step.guess) send({ type: "guess", guess: step.guess });
            if (step.done) send({ type: "end", done: true });
            break;
          }
          case "get_guess": {
            if (!msg.sessionId) return;
            const s = game.getSession(msg.sessionId);
            send({ type: "guess", guess: s?.currentGuess ?? null });
            break;
          }
          case "end": {
            if (!msg.sessionId || !msg.outcome) return;
            await handlers.finalize(msg.sessionId, msg.outcome, msg.actualAnswer);
            send({ type: "end", ended: true });
            break;
          }
          default:
            send({ type: "error", error: "Unknown message type" });
        }
      } catch (err: any) {
        send({ type: "error", error: err?.message || "WS error" });
      }
    });

    ws.on("close", () => {
      // Just log; session remains until /end
    });
  });
}
