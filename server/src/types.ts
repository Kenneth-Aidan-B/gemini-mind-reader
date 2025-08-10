import { z } from "zod";

export type AnswerType = "yes" | "no" | "maybe" | "unknown";

export interface QA {
  question: string;
  answer: AnswerType;
}

export interface GameSession {
  id: string;
  qas: QA[];
  lastQuestion?: string;
  currentGuess?: string;
  startedAt: number;
  endedAt?: number;
  done: boolean;
}

export const AnswerSchema = z.enum(["yes", "no", "maybe", "unknown"]);

export const StartResponseSchema = z.object({
  sessionId: z.string(),
  question: z.string(),
});

export const AnswerResponseSchema = z.object({
  question: z.string().optional(),
  guess: z.string().optional(),
  done: z.boolean(),
});

export const GuessResponseSchema = z.object({
  guess: z.string().nullable(),
});

export const EndRequestSchema = z.object({
  sessionId: z.string(),
  outcome: z.enum(["ai_won", "user_won"]),
  actualAnswer: z.string().optional(),
});

export const StartRequestSchema = z.object({});

export const AnswerRequestSchema = z.object({
  sessionId: z.string(),
  answer: AnswerSchema,
});
