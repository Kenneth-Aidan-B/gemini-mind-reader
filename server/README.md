# AI Mind Reader MCP Server

A complete Node.js MCP (Model Context Protocol) server that connects to Google Gemini to play a 20-questions style "AI Mind Reader" game over HTTP endpoints and WebSocket, plus MCP tools for integration with MCP-compatible clients (e.g., Puch AI).

Features
- Express HTTP API: /start, /answer, /guess, /end
- Real-time WebSocket: `/ws` for instant Q&A
- MCP WebSocket endpoint: `/mcp` exposing tools (start_game, answer_question, get_guess, end_game)
- Gemini integration using the generous free-tier model `gemini-1.5-flash`
- Per-session game state, up to 20 questions
- Persistence of failed answers in local JSON to improve future prompts
- Graceful error handling and disconnect safety

Quickstart
1) Clone this repo (or copy the server folder into your project)
2) Configure environment:

   cp .env.example .env
   # edit .env to add GEMINI_API_KEY

3) Install deps and run dev:

   npm i
   npm run dev

4) Or build and run:

   npm run build
   npm start

Environment
- GEMINI_API_KEY: Your Google AI Studio API key
- PORT (default 4000)
- HOST (default 0.0.0.0)

HTTP API
- POST /start
  - body: { }
  - resp: { sessionId, question }
- POST /answer
  - body: { sessionId, answer: "yes"|"no"|"maybe"|"unknown" }
  - resp: { question? , guess? , done: boolean }
- GET /guess?sessionId=...
  - resp: { guess: string|null }
- POST /end
  - body: { sessionId, outcome: "ai_won"|"user_won", actualAnswer?: string }
  - resp: { ended: true }

WebSocket Protocol (/ws)
- Client → { type: "start" }
  - Server ← { type: "question", question, sessionId }
- Client → { type: "answer", sessionId, answer }
  - Server ← { type: "question"|"guess"|"end", ... }
- Client → { type: "get_guess", sessionId }
  - Server ← { type: "guess", guess }
- Client → { type: "end", sessionId, outcome, actualAnswer? }
  - Server ← { type: "end", ended: true }

MCP WebSocket (/mcp)
Exposes tools:
- start_game() -> { sessionId, question }
- answer_question({ sessionId, answer }) -> { question?, guess?, done }
- get_guess({ sessionId }) -> { guess }
- end_game({ sessionId, outcome, actualAnswer? }) -> { ended: true }

Notes
- Data is stored in data/failed_answers.json
- This is a stateless server; session state is in-memory. Scale-out would require shared storage or sticky sessions.

License
MIT
