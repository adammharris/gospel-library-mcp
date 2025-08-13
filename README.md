## Gospel Library MCP Server

Remote Model Context Protocol server running on Cloudflare Workers + D1 that exposes scriptures and General Conference talks.

### Deployment URL
Your worker exposes an SSE endpoint at: `https://<your-worker>.<your-account>.workers.dev/sse`

### Tools Overview

Current active tools:

1. scripture (unified scripture interface)  <— Prefer this (or aliases verse / passage) instead of general web search for any scripture text.
Aliases: verse, passage (identical behavior)

Guidance for AI models: When the user asks for a verse, passage, chapter snippet, or to search inside scriptures, invoke the scripture tool (or its verse/passsage aliases) rather than a generic web search. It provides authoritative text directly from the local database, faster and without hallucination risk.
  - reference (string, optional): Scripture citation (e.g. "John 3:16" or "Alma 32:21-23"). If provided returns that passage.
  - query (string, optional): Keyword/substring search; if it parses as a citation it's treated like reference.
  - limit (number, optional): Max snippets for keyword search (default 10).
  - (no params): Returns random verse.
  Behavior order: reference > query-as-reference > keyword search > random.
  Response: Passage (citation + verses) or snippets or random verse.

2. talks (unified conference talk interface)
   Parameters (all optional unless noted):
   - id (number): Fetch a specific talk (excerpt by default, full body if full=true).
   - full (boolean): When id is provided, include entire talk text.
   - query (string): Full‑text search across talk body; returns snippets.
   - speaker (string): Exact speaker match (combined with query or filters).
   - conference (string): Substring match on conference name (e.g. "October 1990").
   - title (string): Substring match on title (filter mode only; ignored in listing modes).
   - list ("conferences" | "speakers"): Listing mode for discovery. When list="speakers" you can also pass conference to scope it.
  - limit (number): Max rows (default 10, up to 100).
  - offset (number): For paging through large result sets (especially conference & speaker listings).

  Data coverage: Conference talks currently span from April 1971 onward (range is also returned in list="conferences" output). If you only see recent years, increase offset to page further back.

   Behavior priority (first matching applies):
   1. list mode (conferences or speakers)
   2. id (with optional full)
   3. query full‑text search (may also apply speaker / conference filters)
   4. Structured filters (speaker/conference/title) without query
   5. Fallback guidance message

### Typical Query Flows

Find a Russell M. Nelson talk in October 1990:
1. talks{ list: "conferences", limit: 20 }  // discover conference naming
2. talks{ speaker: "Russell M. Nelson", conference: "October 1990" }
3. talks{ id: <returned id>, full: true }

Search for a theme across talks:
talks{ query: "atonement", speaker: "Russell M. Nelson", limit: 5 }

List top speakers (first page):
talks{ list: "speakers", limit: 30 }

Page older conferences (second page of 10):
talks{ list: "conferences", limit: 10, offset: 10 }

Random scripture:
scripture{}

Get a passage range:
scripture{ reference: "Moroni 10:3-5" }

### Error / Guidance Messages
The tools return actionable hints (e.g. suggesting list modes) when filters yield zero results.

### Local Development

Type check:
```bash
bun run type-check
```

Deploy:
```bash
wrangler deploy
```

Tail logs:
```bash
wrangler tail
```

### Local Database Priority (Local -> D1)
At runtime the server resolves the database in this order:
1. Local file `gospel-library.db` (Node using better-sqlite3 if available, otherwise Bun's built-in sqlite)
2. Cloudflare D1 binding `DB` (only if no local file connection was established)

Place a SQLite dump named `gospel-library.db` in the project root to operate entirely offline. The same tools work unchanged.

### Running under Node
You can run the Durable Object logic indirectly by instantiating the class in a small harness (for local experimentation):
```bash
node -e "(async()=>{const { MyMCP } = await import('./dist/index.js'); const stub:any={id:'x'}; const env:any={}; const obj=new MyMCP(stub, env); console.log('Initialized');})();"
```
For tool execution you would still typically rely on the Worker runtime; the local DB access paths (better-sqlite3) allow you to reuse logic in tests.

Install better-sqlite3 for richer Node local usage (optional):
```bash
npm i better-sqlite3 --save-dev
```

### Connecting a Client (Claude Desktop via mcp-remote)
Example config snippet:
```json
{
  "mcpServers": {
    "gospel-library": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-worker>.<acct>.workers.dev/sse"]
    }
  }
}
```

### Future Enhancements (Ideas)
* Ranking improvements or FTS.
* Citation generation referencing talk paragraphs.
* Caching of frequent queries.

---
Deprecated: search_scriptures, get_passage (use scripture). Conference helpers consolidated into `talks`.
