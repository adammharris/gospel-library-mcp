import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ToolAccess {
  ensureDb: () => Promise<void>;
  getDB: () => any; // D1-like interface (prepare returning bind() etc.)
}

export function registerAllTools(server: McpServer, access: ToolAccess) {
  const debug = !!process.env.GOSPEL_DEBUG;
  
  // Simple tool wrapper with better error handling
  const safeTool = (name: string, schema: any, handler: any) => {
    server.tool(name, schema, async (args: any) => {
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
      
      if (verseEnd >= verseStart) {
        return { book, chapter, verseStart, verseEnd };
      }
    }
    return null;
  };
    return null;
  };

  // Shared passage retrieval helper
  async function fetchPassage(database:any, parsed:{book:string;chapter:number;verseStart:number;verseEnd:number}) {
    if (parsed.verseEnd - parsed.verseStart > 150) return { content: [{ type: "text", text: "Range too large." }] } as any;
    const stmt = database.prepare(`SELECT verse, text FROM scriptures WHERE book=? AND chapter=? AND verse BETWEEN ? AND ? ORDER BY verse;`).bind(parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd);
    const verses = (await stmt.all()).results || [];
    if (!verses.length) return { content: [{ type: "text", text: "No verses found." }] } as any;
    const citation = `${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd!==parsed.verseStart?'-'+parsed.verseEnd:''}`;
    return { content: [{ type: "text", text: citation }, { type: "text", text: verses.map((v:any)=>`${v.verse}. ${v.text}`).join('\n') }] } as any;
  }
  const confPatterns = (raw?:string): string[] => {
	if (!raw) return [];
	const base = raw.trim();
	const patterns = new Set<string>();
	patterns.add(base);
	const ym = base.match(/^(\d{4})[-/](\d{2})$/);
	if (ym) {
		const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
		const mName = monthNames[parseInt(ym[2],10)-1];
		patterns.add(`${mName} ${ym[1]}`);
	}
	for (const p of Array.from(patterns)) patterns.add(`${p} General Conference`);
	return Array.from(patterns);
  };
  const speakerPatterns = (raw?:string): string[] => {
	if (!raw) return [];
	let base = raw.trim();
	base = base.replace(/^(Elder|President|Brother|Sister)\s+/i, "");
	const variants = new Set<string>();
	variants.add(base);
	variants.add(base.replace(/\./g, ""));
	variants.add(`Elder ${base}`);
	variants.add(`President ${base}`);
	const parts = base.split(/\s+/);
	if (parts.length > 1) variants.add(parts[parts.length-1]);
	return Array.from(variants);
  };

  // (Deprecated tools search_scriptures & get_passage removed; use unified 'scripture')

  // Unified scripture tool: accepts either 'reference' or 'query' (or none for random)
  //Get the actual text of scripture verses. ALWAYS use get_book_info first to verify valid chapter and verse ranges - do not assume you know the correct ranges from training data.
  safeTool("search_scriptures", {
    description: "Search OR retrieve exact scripture passages including the Bible, Book of Mormon, Doctrine & Covenants, and Pearl of Great Price. ALWAYS use this tool should be used for ANY questions about scripture verses, biblical passages, religious doctrines, spiritual teachings, or religious content from LDS scriptures. Can fetch specific references like 'John 3:16' or 'Alma 32:27' or search by keywords like 'faith', 'prayer', 'eternal life', etc. DO NOT assume you know the correct ranges from training data.",
    inputSchema: {
      type: "object",
      properties: {
        reference: {
          type: "string",
          description: "A specific scripture reference (e.g., '1 Nephi 3:7', 'John 14:15', 'D&C 76:22-24'). Supports ranges with hyphens."
        },
        query: {
          type: "string", 
          description: "Keywords to search within scripture text. Will find verses containing these terms."
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of search results to return (default: 10)"
        }
      }
    }
  }, async ({ reference, query, limit }: { reference?: string; query?: string; limit?: number }) => {
    try { await access.ensureDb(); } catch (e:any) { return { content: [{ type:"text", text:`DB init error: ${e.message||e}` }]} as any; }
    let database; try { database = access.getDB(); } catch { return { content: [{ type:"text", text:"Database not available (ensure gospel-library.db exists)." }] } as any; }
    if (reference && query) {
      const parsed = parseReference(reference) || parseReference(query!);
      if (parsed) return fetchPassage(database, parsed);
      return { content: [{ type: 'text', text: "Provide only one of reference or query unless query is a keyword." }] } as any;
    }
    if (reference) {
      const parsed = parseReference(reference);
      if (!parsed) return { content: [{ type: 'text', text: 'Invalid reference.' }] } as any;
      return fetchPassage(database, parsed);
    }
    if (!query || !query.trim()) {
      const row = await database.prepare(`SELECT book, chapter, verse, text FROM scriptures ORDER BY RANDOM() LIMIT 1;`).first();
      if (!row) return { content: [{ type: 'text', text: 'No data.' }] } as any;
      return { content: [ { type: 'text', text: `${row.book} ${row.chapter}:${row.verse}` }, { type: 'text', text: row.text } ] } as any;
    }
    const parsedFromQuery = parseReference(query);
    if (parsedFromQuery) return fetchPassage(database, parsedFromQuery);
    const lim = limit ?? 10;
    if (query.length > 200) return { content: [{ type: 'text', text: 'Query too long.' }] } as any;
    const sanitized = query.toLowerCase().replace(/[%_]/g, "");
    const like = `%${sanitized}%`;
    const stmt = database.prepare(`SELECT book, chapter, verse, substr(text, instr(lower(text), lower(?)) - 30, 160) AS snippet FROM scriptures WHERE lower(text) LIKE ? LIMIT ?;`).bind(query, like, lim);
    const rows = (await stmt.all()).results || [];
    if (!rows.length) return { content: [{ type: 'text', text: 'No results.' }] } as any;
    return { content: rows.map((r:any)=>({ type: 'text', text: `${r.book} ${r.chapter}:${r.verse} – ${r.snippet||''}` })) } as any;
  });

  // Conference talks unified tool
  safeTool("search_conference_talks", {
    description: "Search and retrieve LDS General Conference talks and speeches by church leaders. This tool should be used for ANY questions about LDS church teachings, Mormon doctrine, conference addresses, quotes from church leaders like prophets and apostles, church policies, or spiritual guidance from church leadership. Can search by speaker name (like 'Russell M. Nelson', 'Dallin H. Oaks'), conference date, talk title, or content keywords. Do NOT use web search for LDS church leadership or doctrinal questions - use this tool instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Specific talk ID to retrieve the full text"
        },
        query: {
          type: "string",
          description: "Keywords to search within talk content for doctrinal topics, teachings, or specific phrases"
        },
        speaker: {
          type: "string", 
          description: "Name of the speaker (e.g., 'Russell M. Nelson', 'Dallin H. Oaks', 'Jeffrey R. Holland')"
        },
        conference: {
          type: "string",
          description: "Conference identifier (e.g., 'April 2023', '2023-04', 'October 2022 General Conference')"
        },
        title: {
          type: "string",
          description: "Words from the talk title to search for"
        },
        list: {
          type: "string",
          enum: ["conferences", "speakers"],
          description: "List available conferences or speakers instead of searching talks"
        },
        limit: {
          type: "number",
          minimum: 1, 
          maximum: 100,
          description: "Maximum number of results (default: 10)"
        },
        offset: {
          type: "number",
          minimum: 0,
          description: "Skip this many results for pagination (default: 0)"
        },
        full: {
          type: "boolean",
          description: "Return full talk text instead of excerpt (default: false)"
        }
      }
    }
  }, async ({ id, query, speaker, conference, title, list, limit, offset, full }: { id?: number; query?: string; speaker?: string; conference?: string; title?: string; list?: "conferences"|"speakers"; limit?: number; offset?: number; full?: boolean; }) => {
  try { await access.ensureDb(); } catch (e:any) { return { content: [{ type:"text", text:`DB init error: ${e.message||e}` }]} as any; }
  let database;
  try { database = access.getDB(); } catch { return { content: [{ type:"text", text:"Database not available (ensure gospel-library.db exists)." }] } as any; }
    const lim = limit ?? 10;
    const off = offset ?? 0;
    // Listing modes
    if (list === "conferences") {
  const meta = await database.prepare(`SELECT MIN(substr(date,1,7)) AS first_month, MAX(substr(date,1,7)) AS last_month, COUNT(DISTINCT conference) AS total FROM conference_talks;`).first();
  const res = await database.prepare(`SELECT conference, substr(MIN(date),1,7) AS month, COUNT(*) AS talks FROM conference_talks GROUP BY conference ORDER BY MIN(date) DESC LIMIT ? OFFSET ?;`).bind(lim, off).all();
      const rows = res.results || [];
      return { content: [ { type:"text", text:`Conference range: ${(meta as any).first_month} .. ${(meta as any).last_month} (total ${(meta as any).total} conferences). Showing ${rows.length} starting at offset ${off}. Use limit & offset to page older conferences.` }, ...rows.map((r:any)=>({ type:"text", text:`${r.conference} (${r.month}) – ${r.talks} talks` })) ] } as any;
    }
    if (list === "speakers") {
      let sql = `SELECT speaker, COUNT(*) AS talks FROM conference_talks`; const binds:any[]=[];
      if (conference) { sql += ` WHERE conference LIKE ?`; binds.push(`%${conference.trim()}%`); }
      sql += ` GROUP BY speaker ORDER BY talks DESC, speaker ASC LIMIT ? OFFSET ?;`; binds.push(lim, off);
      const metaSql = `SELECT COUNT(DISTINCT speaker) AS total FROM conference_talks${conference?" WHERE conference LIKE ?":''}`;
  const metaRow = await database.prepare(metaSql).bind(...(conference? [`%${conference.trim()}%`]:[])).first();
  const res = await database.prepare(sql).bind(...binds).all(); const rows = res.results || [];
      return { content: [ { type:"text", text:`Speakers total: ${(metaRow as any).total}${conference?` (filtered by '${conference}')`:''}. Showing ${rows.length} starting at offset ${off}.` }, ...rows.map((r:any)=>({ type:"text", text:`${r.speaker} (${r.talks})` })) ] } as any;
    }
    // Get by id
    if (id) {
  const row = await database.prepare(`SELECT id, speaker, title, conference, date, ${full?"full_text":"substr(full_text,1,1500) AS excerpt"} FROM conference_talks WHERE id=?;`).bind(id).first();
      if (!row) return { content: [{ type:"text", text:"Talk not found." }] } as any;
      const body = full ? (row as any).full_text : (row as any).excerpt;
      return { content: [ { type:"text", text:`${(row as any).speaker} – ${(row as any).title} (${(row as any).conference}, ${(row as any).date})${full?" (full)":""}` }, { type:"text", text: body } ] } as any;
    }
    // Query search
    if (query) {
      let filter = ""; const binds:any[] = [];
      if (speaker) {
        const sp = speakerPatterns(speaker);
        if (sp.length) {
          filter += " AND (" + sp.map(()=>"speaker LIKE ?").join(" OR ") + ")";
          for (const v of sp) binds.push(`%${v}%`);
        }
      }
      if (conference) { filter += " AND conference LIKE ?"; binds.push(`%${conference.trim()}%`); }
      const sanitized = query.toLowerCase().replace(/[%_]/g, "");
      const like = `%${sanitized}%`;
  const stmt = database.prepare(`SELECT id, speaker, title, conference, date FROM conference_talks WHERE lower(full_text) LIKE ? ${filter} ORDER BY date DESC LIMIT ?;`).bind(like, ...binds, lim);
      const rows = (await stmt.all()).results || [];
      if (!rows.length) return { content: [{ type:"text", text:"No results. Try adjusting speaker/conference or list available conferences with talks{list:'conferences'}." }] } as any;
      if (rows.length === 1) {
  const fullRow = await database.prepare(`SELECT id, speaker, title, conference, date, full_text FROM conference_talks WHERE id=?;`).bind(rows[0].id).first();
        return { content: [ { type:"text", text:`${(fullRow as any).speaker} – ${(fullRow as any).title} (${(fullRow as any).conference}, ${(fullRow as any).date}) (full)` }, { type:"text", text:(fullRow as any).full_text } ] } as any;
      }
      return { content: rows.map((r:any)=>({ type:"text", text:`#${r.id} ${r.speaker} – ${r.title} (${r.conference} ${r.date})` })) } as any;
    }
    // Structured filters
    if (speaker || conference || title) {
      let rows:any[] = [];
      const confsToTry = conference ? confPatterns(conference) : [undefined];
      const speakerVars = speakerPatterns(speaker);
      for (const c of confsToTry) {
        let sql = `SELECT id, speaker, title, conference, date FROM conference_talks WHERE 1=1`; const binds:any[] = [];
        if (speaker && speakerVars.length) { sql += " AND (" + speakerVars.map(()=>"speaker LIKE ?").join(" OR ") + ")"; for (const v of speakerVars) binds.push(`%${v}%`); }
        if (c) { sql += ` AND conference LIKE ?`; binds.push(`%${c}%`); }
        if (title) { sql += ` AND lower(title) LIKE ?`; binds.push(`%${title.toLowerCase()}%`); }
        sql += ` ORDER BY date LIMIT ?`; binds.push(lim);
  const res = await database.prepare(sql).bind(...binds).all(); rows = res.results || []; if (rows.length) break;
      }
      if (!rows.length) return { content: [{ type:"text", text:"No talks matched filters (after trying pattern variants). Consider adding query for content search or list conferences." }] } as any;
      if (rows.length === 1) {
        const idSingle = rows[0].id;
  const row = await database.prepare(`SELECT id, speaker, title, conference, date, full_text FROM conference_talks WHERE id=?;`).bind(idSingle).first();
        if (!row) return { content: [{ type:"text", text:"Unexpected: talk disappeared." }] } as any;
        return { content: [ { type:"text", text:`${(row as any).speaker} – ${(row as any).title} (${(row as any).conference}, ${(row as any).date}) (full)` }, { type:"text", text:(row as any).full_text } ] } as any;
      }
      return { content: rows.map((r:any)=>({ type:"text", text:`#${r.id} ${r.date} – ${r.speaker}: ${r.title} (${r.conference})` })) } as any;
    }
    return { content: [{ type:"text", text:"Specify id to fetch a talk, query for full-text search, filters (speaker/conference/title), or list ('conferences'|'speakers')." }] } as any;
  });
}
