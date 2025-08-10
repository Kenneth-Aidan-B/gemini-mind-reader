import { v4 as uuidv4 } from "uuid";
import { AnswerType, GameSession, QA } from "./types";

const MAX_QUESTIONS = 20;

export class GameManager {
  private sessions = new Map<string, GameSession>();

  createSession(): GameSession {
    const id = uuidv4();
    const session: GameSession = {
      id,
      qas: [],
      startedAt: Date.now(),
      done: false,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  applyAnswer(session: GameSession, question: string, answer: AnswerType) {
    const qa: QA = { question, answer };
    session.qas.push(qa);
    session.lastQuestion = undefined;
    if (session.qas.length >= MAX_QUESTIONS) {
      session.done = true;
    }
  }

  setLastQuestion(session: GameSession, question: string) {
    session.lastQuestion = question;
  }

  setGuess(session: GameSession, guess: string) {
    session.currentGuess = guess;
  }

  endSession(session: GameSession) {
    session.done = true;
    session.endedAt = Date.now();
  }
}
