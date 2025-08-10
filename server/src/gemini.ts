import { GoogleGenerativeAI } from "@google/generative-ai";
import { GameSession, QA } from "./types";
import { readFailedAnswers } from "./persistence";

const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // generous free-tier

function buildSystemPrompt(session: GameSession) {
  const qas = session.qas
    .map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`)
    .join("\n");
  const failed = readFailedAnswers();
  const failedHints = failed.length
    ? `Here are some previously missed answers users thought of: ${failed
        .slice(-50)
        .map((f) => f.answer)
        .join(", "
      )}. Use them as hints only; do not assume they are correct.`
    : "";

  return `You are an expert 20-questions strategist. The user is thinking of an object, person, place, or concept.\n
Your goal is to guess it within 20 yes/no/maybe questions.\n
Guidelines:\n- Ask highly discriminative yes/no/maybe questions.\n- Keep questions concise (max ~15 words).\n- When sufficiently confident, give a FINAL_GUESS.\n- Avoid repeating questions.\n- Respect the answer count limit.\n- If you are not yet confident, ask the next best question.\n- Consider user's previous answers strictly.\n${failedHints}\n
History so far:\n${qas || "(none)"}\n
Output format (strict):\n- If asking another question: QUESTION: <your question>\n- If making a final guess: FINAL_GUESS: <your single best guess>`;
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async nextStep(session: GameSession): Promise<{ question?: string; guess?: string }> {
    const model = this.genAI.getGenerativeModel({ model: MODEL });

    const prompt = buildSystemPrompt(session);

    const historyText = session.qas
      .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
      .join("\n");

    const input = `${prompt}\n\nThinking limit: ${20 - session.qas.length} remaining.`;

    const resp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: input }] }] });
    const text = resp.response.text().trim();

    if (/^FINAL_GUESS:/i.test(text)) {
      return { guess: text.replace(/^FINAL_GUESS:/i, "").trim() };
    }
    if (/^QUESTION:/i.test(text)) {
      return { question: text.replace(/^QUESTION:/i, "").trim() };
    }

    // Fallback: try to parse heuristically
    if (text.toLowerCase().includes("final_guess:")) {
      const m = text.match(/final_guess:\s*(.+)/i);
      if (m) return { guess: m[1].trim() };
    }
    const qMatch = text.match(/question:\s*(.+)/i);
    if (qMatch) return { question: qMatch[1].trim() };

    // Worst case: ask a generic discriminative question
    return { question: "Is it a living thing?" };
  }
}
