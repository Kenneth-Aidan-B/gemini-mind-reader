import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { z } from "zod";
import { GameManager } from "./game";
import { GeminiClient } from "./gemini";
import { appendFailedAnswer } from "./persistence";
import { AnswerRequestSchema, EndRequestSchema, GuessResponseSchema, StartRequestSchema } from "./types";
import { attachGameWebSocket } from "./ws";
import { attachMCP } from "./mcp";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY not set. The server will start, but Gemini calls will fail.");
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const game = new GameManager();
const gemini = new GeminiClient(process.env.GEMINI_API_KEY || "");

async function computeNext(sessionId: string) {
  const session = game.getSession(sessionId);
  if (!session) throw new Error("Invalid sessionId");

  // If there is no pending question, ask one/guess
  if (!session.lastQuestion && !session.done) {
    const step = await gemini.nextStep(session);
    if (step.guess) {
      game.setGuess(session, step.guess);
      return { question: undefined as any, guess: step.guess, done: session.done };
    }
    const q = step.question || "Is it man-made?";
    game.setLastQuestion(session, q);
    return { question: q, guess: undefined as any, done: session.done };
  }

  return { question: session.lastQuestion, guess: session.currentGuess, done: session.done };
}

// Health check endpoint for Railway
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "gemini-mind-reader-mcp", timestamp: new Date().toISOString() });
});

// Routes
app.post("/start", async (_req, res) => {
  try {
    const session = game.createSession();
    const step = await computeNext(session.id);
    res.json({ sessionId: session.id, question: step.question });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to start game" });
  }
});

app.post("/answer", async (req, res) => {
  try {
    const parsed = AnswerRequestSchema.parse(req.body);
    const session = game.getSession(parsed.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.lastQuestion) return res.status(400).json({ error: "No pending question" });

    game.applyAnswer(session, session.lastQuestion, parsed.answer);

    if (session.done) {
      // Make a final guess if possible
      const step = await gemini.nextStep(session);
      if (step.guess) game.setGuess(session, step.guess);
      game.endSession(session);
      return res.json({ guess: session.currentGuess, done: true });
    }

    const step = await gemini.nextStep(session);
    if (step.guess) {
      game.setGuess(session, step.guess);
      return res.json({ guess: step.guess, done: false });
    }
    const q = step.question || "Is it larger than a breadbox?";
    game.setLastQuestion(session, q);
    return res.json({ question: q, done: false });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: "Invalid input", details: err.issues });
    res.status(500).json({ error: err?.message || "Failed to process answer" });
  }
});

app.get("/guess", async (req, res) => {
  try {
    const sessionId = (req.query.sessionId as string) || "";
    const session = game.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ guess: session.currentGuess ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get guess" });
  }
});

app.post("/end", async (req, res) => {
  try {
    const parsed = EndRequestSchema.parse(req.body);
    const session = game.getSession(parsed.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    game.endSession(session);
    if (parsed.outcome === "user_won" && parsed.actualAnswer) {
      appendFailedAnswer(parsed.actualAnswer);
    }
    res.json({ ended: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: "Invalid input", details: err.issues });
    res.status(500).json({ error: err?.message || "Failed to end game" });
  }
});

// WebSocket for real-time Q&A
attachGameWebSocket(server, "/ws", game, {
  nextStep: async (sessionId: string) => {
    const session = game.getSession(sessionId);
    if (!session) throw new Error("Invalid session");

    // If there's a pending question, it means client just connected; otherwise compute
    if (!session.lastQuestion && !session.done) {
      const step = await gemini.nextStep(session);
      if (step.guess) {
        game.setGuess(session, step.guess);
        return { guess: step.guess, done: session.done } as any;
      }
      const q = step.question || "Is it commonly found indoors?";
      game.setLastQuestion(session, q);
      return { question: q, done: session.done } as any;
    }

    return { question: session.lastQuestion, guess: session.currentGuess, done: session.done } as any;
  },
  finalize: async (sessionId, outcome, actualAnswer) => {
    const session = game.getSession(sessionId);
    if (!session) return;
    game.endSession(session);
    if (outcome === "user_won" && actualAnswer) appendFailedAnswer(actualAnswer);
  },
});

// MCP WebSocket endpoint exposing tools
attachMCP(server, "/mcp", game, {
  start: async () => {
    const session = game.createSession();
    const step = await gemini.nextStep(session);
    const q = step.question || "Is it bigger than a microwave?";
    game.setLastQuestion(session, q);
    return { sessionId: session.id, question: q };
  },
  answer: async (sessionId, answer) => {
    const session = game.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    if (!session.lastQuestion) throw new Error("No pending question");

    game.applyAnswer(session, session.lastQuestion, answer);
    if (session.done) {
      const step = await gemini.nextStep(session);
      if (step.guess) game.setGuess(session, step.guess);
      game.endSession(session);
      return { guess: session.currentGuess, done: true } as any;
    }

    const step = await gemini.nextStep(session);
    if (step.guess) {
      game.setGuess(session, step.guess);
      return { guess: step.guess, done: false } as any;
    }
    const q = step.question || "Can it fit in a backpack?";
    game.setLastQuestion(session, q);
    return { question: q, done: false } as any;
  },
  getGuess: async (sessionId) => {
    const session = game.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    return { guess: session.currentGuess ?? null };
  },
  end: async (sessionId, outcome, actualAnswer) => {
    const session = game.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    game.endSession(session);
    if (outcome === "user_won" && actualAnswer) appendFailedAnswer(actualAnswer);
    return { ended: true };
  },
});

server.listen(PORT, HOST, () => {
  console.log(`AI Mind Reader MCP server listening at http://${HOST}:${PORT}`);
});
