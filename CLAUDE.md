# Agent Rules
- Follow all agents instructions to the fullest, don't choose, if you are executing an agent follow it completely.

- Always log critical application operations (e.g., transactions, webhooks, authentication) including their status for easier debugging.

- Never guess backend response shapes or external service shapes; always verify by exploring or searching online to use the exact declared types before wiring frontend or service logic.

- when you detect file size is becoming too large (>1000 lines), split code into more chunks with more specialized functions and into separate files.

- Don't create migration files, yourself, instead use cli to generate migrations.

- Avoid using fallbacks, if data is dynamic and you don't understand the right value explicitly break and ask me.



- Anytime an agent wants to modify documentation (including OpenAPI specs or related docs), it should delegate this to the `openapi-reconciler` agent.
