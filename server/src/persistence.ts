import fs from "fs";
import path from "path";

export interface FailedAnswerEntry {
  answer: string; // what the user was thinking of when AI failed
  timestamp: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "failed_answers.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify([]), "utf-8");
  }
}

export function readFailedAnswers(): FailedAnswerEntry[] {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function appendFailedAnswer(answer: string) {
  try {
    ensureDataFile();
    const list = readFailedAnswers();
    list.push({ answer, timestamp: Date.now() });
    // atomic-ish write
    const tmp = FILE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf-8");
    fs.renameSync(tmp, FILE_PATH);
  } catch (err) {
    console.error("Failed to persist failed answer:", err);
  }
}
