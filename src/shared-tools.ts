import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ToolAccess {
  ensureDb: () => Promise<void>;
  getDB: () => any;
}

export function registerAllTools(server: McpServer, access: ToolAccess) {
  const debug = !!process.env.GOSPEL_DEBUG;
  
  // Simple tool wrapper with better error handling
  const safeTool = (name: string, description: string, inputSchema: any, handler: any) => {
    server.registerTool(name, {
      title: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Convert snake_case to Title Case
      description: description,
      inputSchema: inputSchema
    }, async (args: any) => {
      try {
        if (debug) console.error(`[gospel-library] tool invoke ${name}`);
        
        // Single DB initialization
        await access.ensureDb();
        const database = access.getDB();
        
        const res = await handler(args, database);
        if (debug) console.error(`[gospel-library] tool result ${name} ok`);
        return res;
      } catch (e: any) {
        console.error(`[gospel-library] tool error ${name}:`, e?.message || e);
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: ${e?.message || 'Tool execution failed'}` 
          }] 
        };
      }
    });
  };

  // Simplified scripture reference parser
  const parseReference = (input: string) => {
    if (!input?.trim()) return null;
    
    const normalized = input.replace(/[\u2012-\u2015\u2212]/g, '-').trim();
    const match = normalized.match(/^\s*([1-3]?\s?[A-Za-z&\. ]+?)\s+(\d+):(\d+)(?:-(\d+))?\s*$/);
    
    if (match) {
      const book = match[1].replace(/\s+/g, ' ').trim();
      const chapter = parseInt(match[2]);
      const verseStart = parseInt(match[3]);
      const verseEnd = match[4] ? parseInt(match[4]) : verseStart;
      
      if (verseEnd >= verseStart && chapter > 0 && verseStart > 0) {
        return { book, chapter, verseStart, verseEnd };
      }
    }
    return null;
  };

  // Simplified passage fetcher
  const fetchPassage = async (database: any, parsed: any) => {
    if (parsed.verseEnd - parsed.verseStart > 50) {
      return { content: [{ type: "text", text: "Verse range too large (max 50 verses)" }] };
    }

    const stmt = database.prepare(`SELECT verse, text FROM scriptures WHERE book=? AND chapter=? AND verse BETWEEN ? AND ? ORDER BY verse;`);
    const result = await stmt.bind(parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd).all();
    const verses = result.results || [];

    if (!verses.length) {
      return { content: [{ type: "text", text: `No verses found for ${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd !== parsed.verseStart ? '-' + parsed.verseEnd : ''}` }] };
    }

    const citation = `${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd !== parsed.verseStart ? '-' + parsed.verseEnd : ''}`;
    const versesText = verses.map((v: any) => `${v.verse} ${v.text}`).join('\n');
    
    return { 
      content: [
        { type: "text", text: citation },
        { type: "text", text: versesText }
      ] 
    };
  };

  // Exact scripture retrieval tool
  safeTool(
    "get_exact_scripture",
    "Fetch an exact LDS scripture verse or short contiguous range (Bible, Book of Mormon, D&C, Pearl of Great Price). Always call before quoting scripture wording.",
    {
      reference: z.string().describe("Required. A verse or short range: 'John 3:16', 'Alma 32:27-28', '1 Nephi 3:7'. Range limit: <=50 verses.")
    },
    async ({ reference }: { reference: string }, database: any) => {
    if (!reference) {
      return { content: [{ type: 'text', text: 'Missing required parameter: reference' }] };
    }
    const parsed = parseReference(reference);
    if (!parsed) {
      return { content: [{ type: 'text', text: 'Invalid scripture reference. Examples: "John 3:16", "1 Nephi 3:7", "Alma 32:27-28"' }] };
    }
    return fetchPassage(database, parsed);
  });

  // Scripture keyword/topic search tool
  safeTool(
    "search_scriptures_by_keyword",
    "Search LDS scriptures by keyword/phrase (topic discovery). Use before teaching on a topic or when user asks 'verses about X'.",
    {
      query: z.string().describe("Required. Keyword or short phrase (<100 chars), e.g. 'charity', 'plan of salvation', 'endure to the end'."),
      limit: z.number().min(1).max(20).optional().describe("Max number of results (default 10).")
    },
    async ({ query, limit }: { query: string; limit?: number }, database: any) => {
    if (!query) {
      return { content: [{ type: 'text', text: 'Missing required parameter: query' }] };
    }
    if (query.length > 100) {
      return { content: [{ type: 'text', text: 'Search query too long (max 100 characters)' }] };
    }
    const lim = Math.min(limit || 10, 20);
    const stmt = database.prepare(`SELECT book, chapter, verse, text FROM scriptures WHERE lower(text) LIKE ? LIMIT ?;`);
    const result = await stmt.bind(`%${query.toLowerCase()}%`, lim).all();
    const rows = result.results || [];
    if (!rows.length) {
      return { content: [{ type: 'text', text: 'No results found.' }] };
    }
    return { 
      content: rows.map((r: any) => ({ 
        type: 'text', 
        text: `${r.book} ${r.chapter}:${r.verse} - ${r.text.substring(0, 150)}${r.text.length > 150 ? '...' : ''}` 
      }))
    };
  });

  // Random scripture tool (optional utility)
  safeTool(
    "get_random_scripture",
    "Return a single random scripture verse (any standard work). Useful for daily verse prompts.",
    {},
    async (_args: {}, database: any) => {
    const stmt = database.prepare(`SELECT book, chapter, verse, text FROM scriptures ORDER BY RANDOM() LIMIT 1;`);
    const row = await stmt.first();
    if (!row) {
      return { content: [{ type: 'text', text: 'No scriptures available.' }] };
    }
    return { 
      content: [
        { type: 'text', text: `${row.book} ${row.chapter}:${row.verse}` },
        { type: 'text', text: row.text }
      ]
    };
  });

  // Conference talks tool
  safeTool(
    "search_conference_talks",
    "General Conference talks (modern prophets/apostles). Use for quotes, sourcing, or locating talks by speaker, conference, or topic. Use 'id' for a specific talk; otherwise filter with speaker/conference/query (keep query <100 chars). Combine with scripture tool if both modern and canonical sources are requested. Always fetch before quoting.",
    {
      id: z.number().optional().describe("Specific talk ID to retrieve"),
      query: z.string().optional().describe("Keyword(s)/phrase to search in talk content. Keep under 100 chars."),
      speaker: z.string().optional().describe("Speaker name (full or partial). E.g. 'Nelson', 'Russell M. Nelson', 'Holland'."),
      conference: z.string().optional().describe("Conference identifier (e.g., 'April 2023', 'Oct 2022', or '2023-04')."),
      limit: z.number().min(1).max(20).optional().describe("Maximum number of results (default 10). Use smaller numbers for broad topics.")
    },
    async ({ id, query, speaker, conference, limit }: { id?: number; query?: string; speaker?: string; conference?: string; limit?: number }, database: any) => {
    
    // Get specific talk by ID
    if (id) {
      const stmt = database.prepare(`SELECT speaker, title, conference, date, full_text FROM conference_talks WHERE id=?;`);
      const row = await stmt.bind(id).first();
      if (!row) {
        return { content: [{ type: 'text', text: 'Talk not found.' }] };
      }
      
      const text = row.full_text || '';
      const truncated = text.length > 1500 ? text.substring(0, 1500) + '...\n[Text truncated - use ID to get full talk]' : text;
      
      return { 
        content: [
          { type: 'text', text: `${row.speaker} - ${row.title} (${row.conference}, ${row.date})` },
          { type: 'text', text: truncated }
        ] 
      };
    }

    // Build search query
    let sql = `SELECT id, speaker, title, conference, date, substr(full_text, 1, 200) as excerpt FROM conference_talks WHERE 1=1`;
    const binds: any[] = [];

    if (speaker) {
      sql += ` AND lower(speaker) LIKE ?`;
      binds.push(`%${speaker.toLowerCase()}%`);
    }

    if (conference) {
      sql += ` AND lower(conference) LIKE ?`;
      binds.push(`%${conference.toLowerCase()}%`);
    }

    if (query) {
      if (query.length > 100) {
        return { content: [{ type: 'text', text: 'Search query too long (max 100 characters)' }] };
      }
      sql += ` AND lower(full_text) LIKE ?`;
      binds.push(`%${query.toLowerCase()}%`);
    }

    const lim = Math.min(limit || 10, 20);
    sql += ` ORDER BY date DESC LIMIT ?`;
    binds.push(lim);

    const stmt = database.prepare(sql);
    const result = await stmt.bind(...binds).all();
    const rows = result.results || [];

    if (!rows.length) {
      return { content: [{ type: 'text', text: 'No talks found matching those criteria.' }] };
    }

    return { 
      content: rows.map((r: any) => ({ 
        type: 'text', 
        text: `[ID: ${r.id}] ${r.speaker} - ${r.title} (${r.conference})\n${r.excerpt}...` 
      }))
    };
  });
}
