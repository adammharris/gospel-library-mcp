## Gospel Library MCP Server

Remote Model Context Protocol server running on Cloudflare Workers + D1 that exposes scriptures and General Conference talks.

### Deployment URL
Your worker exposes an SSE endpoint at: `https://<your-worker>.<your-account>.workers.dev/sse`

### Tools Overview

Current active tools:

1. search_scriptures
   - query (optional string): Substring to search scripture text (case-insensitive). If omitted or blank, returns a random verse.
   - limit (optional number, default 10): Max verses/snippets.
   Response: Verse references with surrounding snippet or a random verse + text.

2. get_passage
   - reference (string): Standard scripture citation (e.g. "John 3:16" or "Alma 32:21-23").
   Response: Citation line and numbered verses.

3. talks (unified conference talk interface)
   Parameters (all optional unless noted):
   - id (number): Fetch a specific talk (excerpt by default, full body if full=true).
   - full (boolean): When id is provided, include entire talk text.
   - query (string): Full‑text search across talk body; returns snippets.
   - speaker (string): Exact speaker match (combined with query or filters).
   - conference (string): Substring match on conference name (e.g. "October 1990").
   - title (string): Substring match on title (filter mode only; ignored in listing modes).
   - list ("conferences" | "speakers"): Listing mode for discovery. When list="speakers" you can also pass conference to scope it.
   - limit (number): Max rows (default 10, up to 100).

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

List top speakers:
talks{ list: "speakers", limit: 30 }

Random scripture:
search_scriptures{}  // no query

Get a passage range:
get_passage{ reference: "Moroni 10:3-5" }

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
All former conference helper tools were consolidated into the single `talks` tool.
