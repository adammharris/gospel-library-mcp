# Gospel Library MCP Server (Unofficial)

This is a Model Context Protocol server for LLM interfaces such as Claude, ChatGPT, or LM Studio. You can set up a remote server via Cloudflare Workers (free), or you can run the MCP server locally using node.

## Quick Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adammharris/gospel-library-mcp)

**One-click deployment to Cloudflare Workers** - Sets up your own free MCP server instance in under 2 minutes.


## Tools Overview

Current active tools:

1. **get_exact_scripture** - Fetch an exact LDS scripture verse or short contiguous range
   - **reference** (string, required): A verse or short range like "John 3:16", "Alma 32:27-28", "1 Nephi 3:7". Range limit: ≤50 verses.
   - **Fuzzy matching supported**: "Matt 5:16" → "Matthew 5:16", "Omni 7" → "Omni 1:7", "Doc 121" → "D&C 121"
   - Always call before quoting scripture wording to ensure accuracy.

2. **search_scriptures_by_keyword** - Search LDS scriptures by keyword/phrase for topic discovery
   - **query** (string, required): Keyword or short phrase (<100 chars), e.g. "charity", "plan of salvation", "endure to the end"
   - **limit** (number, optional): Max number of results (default 10, max 20)
   - Use before teaching on a topic or when user asks "verses about X".

3. **get_random_scripture** - Return a single random scripture verse
   - No parameters required
   - Useful for daily verse prompts or inspiration.

4. **search_conference_talks** - General Conference talks search and retrieval
   - **id** (number, optional): Specific talk ID to retrieve full talk
   - **query** (string, optional): Keyword(s)/phrase to search in talk content (<100 chars)
   - **speaker** (string, optional): Speaker name with fuzzy matching. E.g. "Nelson", "Russell M. Nelson", "Russel Nelson"
   - **conference** (string, optional): Conference identifier with fuzzy matching. E.g. "April 2023", "Oct 2022", "October 1990"
   - **limit** (number, optional): Maximum results (default 10, max 20)
   
   **Enhanced Features:**
   - **Fuzzy matching**: "Russel M. Nelson" matches "Russell M. Nelson", "Oct 1990" matches "October 1990"
   - **Smart single results**: When only 1 talk matches, returns full talk content automatically
   - **Intelligent filtering**: Combines multiple parameters for precise searches
   - Always fetch before quoting to ensure accuracy.

### Typical Query Flows

**Find a specific scripture reference:**
```
get_exact_scripture{ reference: "John 3:16" }
get_exact_scripture{ reference: "Omni 7" }  // Fuzzy matches to Omni 1:7
get_exact_scripture{ reference: "Matt 5:16" }  // Fuzzy matches to Matthew 5:16
```

**Search scriptures by topic:**
```
search_scriptures_by_keyword{ query: "charity", limit: 5 }
search_scriptures_by_keyword{ query: "plan of salvation" }
```

**Find a Russell M. Nelson talk from October 1990:**
```
search_conference_talks{ speaker: "Russell M. Nelson", conference: "October 1990" }
```

**Search for talks about a specific topic:**
```
search_conference_talks{ query: "atonement", speaker: "Russell M. Nelson", limit: 5 }
search_conference_talks{ query: "faith", conference: "April 2023" }
```

**Get a full talk by ID:**
```
search_conference_talks{ id: 12345 }
```

**Get a random scripture:**
```
get_random_scripture{}
```

### Key Features

**Scripture Tools:**
- **Comprehensive coverage**: Bible, Book of Mormon, Doctrine & Covenants, Pearl of Great Price
- **Intelligent fuzzy matching**: Handles abbreviations and common misspellings
- **Flexible reference parsing**: Supports "Book Chapter:Verse", "Book Verse" (assumes chapter 1), and D&C sections
- **Fast keyword search**: Full-text search across all scriptures
- **Random verse generator**: Perfect for daily inspiration

**Conference Talk Tools:**
- **Modern prophet teachings**: Conference talks from April 1971 onward
- **Smart speaker matching**: Finds speakers even with typos ("Russel" → "Russell")
- **Conference abbreviations**: "Oct 1990" → "October 1990", "Apr 2023" → "April 2023"
- **Intelligent results**: Single matches return full talk content automatically
- **Multi-parameter filtering**: Combine speaker, conference, and keyword searches

### Error / Guidance Messages
The tools return actionable hints when no results are found, suggesting alternative search approaches or parameter adjustments.

## Local Development

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

### Connecting a Client

There are two ways to connect to a client: locally and remotely. For developer use, local is recommended. Remote is easier to set up and uses the Cloudflare endpoint.

#### Local

Example config snippet:
```json
{
  "mcpServers": {
    "gospel-library": {
      "command": "node",
      "args": ["/Users/path/to/repository/dist/stdio-server.js"],
      "env": { "GOSPEL_DB_PATH": "/Users/path/to/database/gospel-library.db"}
    }
  }
}
```

#### Remote

**Option 1: One-Click Deploy (Recommended)**

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adammharris/gospel-library-mcp)

This will:
1. Fork the repository to your GitHub account
2. Set up a Cloudflare Workers deployment
3. Configure the D1 database automatically
4. Deploy your MCP server instance

Once deployed, use your Worker URL with the `/sse` endpoint in your MCP client.

**Option 2: Manual Deployment**

1. Clone this repository
2. Install dependencies: `npm install`
3. Set up Cloudflare Workers CLI: `npm install -g wrangler`
4. Login to Cloudflare: `wrangler login`
5. Create D1 database: `wrangler d1 create gospel-library`
6. Update database ID in `wrangler.jsonc`
7. Deploy: `wrangler deploy`

**Option 3: Use Existing Deployment**

No authentication is required to use this tool. You will need a client that supports remote MCP servers, such as Claude on a Pro plan or ChatGPT on a Pro plan.

URL: `https://gospel-library-mcp.harrisadam42103.workers.dev/sse`

### Future Enhancements (Ideas)
* Ranking improvements or FTS.
* Citation generation referencing talk paragraphs.
* Caching of frequent queries.
* Footnotes
* Optionally allow for web scraping
* More resources from Gospel Library
