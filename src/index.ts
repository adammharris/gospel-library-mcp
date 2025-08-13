import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface EnvWithDB extends Env { DB: D1Database }

export class MyMCP extends McpAgent<EnvWithDB> {
	// Shared server and DB across instances
	static sharedServer: McpServer | null = null;
	static db: D1Database | null = null;
	server: McpServer;

	constructor(state: DurableObjectState, env: EnvWithDB) {
		// @ts-ignore
		super(state, env);
		if (!MyMCP.sharedServer) {
			const server = new McpServer({ name: "gospel-library", version: "0.1.0" });
			if (!MyMCP.db) MyMCP.db = env.DB;
			// Reference parsing helpers
			const dashNorm = (s: string) => s.replace(/[\u2012-\u2015\u2212]/g, "-").trim();
			const bookMap: Record<string,string> = {"gen":"Genesis","jn":"John","john":"John","alma":"Alma","d&c":"Doctrine and Covenants","dc":"Doctrine and Covenants","doctrine and covenants":"Doctrine and Covenants","moroni":"Moroni","mosiah":"Mosiah","3 nephi":"3 Nephi","2 nephi":"2 Nephi","1 nephi":"1 Nephi","helaman":"Helaman"};
			const refRegex = /^\s*([1-3]?\s?[A-Za-z&\. ]+?)\s+(\d+):(\d+)(?:-(\d+))?\s*$/;
			const normalizeBook = (raw:string) => { const k=raw.toLowerCase().replace(/\./g,"").replace(/\s+/g," ").trim(); return bookMap[k]||raw.replace(/\s+/g," ").trim(); };
			const parseReference = (input:string) => { const m=dashNorm(input).match(refRegex); if(!m) return null; const book=normalizeBook(m[1]); if(!book) return null; const chapter=+m[2]; const verseStart=+m[3]; const verseEnd=m[4]?+m[4]:verseStart; if(verseEnd<verseStart) return null; return {book,chapter,verseStart,verseEnd}; };
			const getDB = () => {
				if (!MyMCP.db) throw new Error("DB not initialized");
				return MyMCP.db;
			};

			server.tool("search_scriptures", { query: z.string().optional(), limit: z.number().min(1).max(50).optional() }, async ({ query, limit }) => {
				const lim = limit ?? 10;
				// Random verse mode when no query provided.
				if (!query || !query.trim()) {
					const row = await getDB().prepare(`SELECT book, chapter, verse, text FROM scriptures ORDER BY RANDOM() LIMIT 1;`).first();
					if (!row) return { content: [{ type: "text", text: "No data." }] } as any;
					return { content: [{ type: "text", text: `${(row as any).book} ${(row as any).chapter}:${(row as any).verse}` }, { type: "text", text: (row as any).text }] } as any;
				}
				if (query.length > 200) return { content: [{ type: "text", text: "Query too long." }] } as any;
				const sanitized = query.toLowerCase().replace(/[%_]/g, "");
				const like = `%${sanitized}%`;
				const stmt = getDB().prepare(`SELECT book, chapter, verse, substr(text, instr(lower(text), lower(?)) - 30, 160) AS snippet FROM scriptures WHERE lower(text) LIKE ? LIMIT ?;`).bind(query, like, lim);
				const rows = (await stmt.all()).results || [];
				if (!rows.length) return { content: [{ type: "text", text: "No results." }] } as any;
				return { content: rows.map((r:any)=>({ type: "text", text: `${r.book} ${r.chapter}:${r.verse} – ${r.snippet||''}` })) } as any;
			});

			server.tool("get_passage", { reference: z.string() }, async ({ reference }) => {
				const parsed = parseReference(reference);
				if (!parsed) return { content: [{ type: "text", text: "Invalid reference." }] };
				if (parsed.verseEnd - parsed.verseStart > 150) return { content: [{ type: "text", text: "Range too large." }] };
				const stmt = getDB().prepare(`SELECT verse, text FROM scriptures WHERE book=? AND chapter=? AND verse BETWEEN ? AND ? ORDER BY verse;`).bind(parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd);
				const verses = (await stmt.all()).results || [];
				if (!verses.length) return { content: [{ type: "text", text: "No verses found." }] };
				const citation = `${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd!==parsed.verseStart?'-'+parsed.verseEnd:''}`;
				return { content: [{ type: "text", text: citation }, { type: "text", text: verses.map((v:any)=>`${v.verse}. ${v.text}`).join('\n') }] };
			});


			// Unified conference talks tool
			server.tool("talks", {
				id: z.number().int().positive().optional(),
				query: z.string().optional(),
				speaker: z.string().optional(),
				conference: z.string().optional(),
				title: z.string().optional(),
				list: z.enum(["conferences","speakers"]).optional(),
				limit: z.number().min(1).max(100).optional(),
				full: z.boolean().optional()
			}, async ({ id, query, speaker, conference, title, list, limit, full }) => {
				const lim = limit ?? 10;
				// Listing modes
				if (list === "conferences") {
					const res = await getDB().prepare(`SELECT conference, substr(MIN(date),1,7) AS month, COUNT(*) AS talks FROM conference_talks GROUP BY conference ORDER BY MIN(date) DESC LIMIT ?;`).bind(lim).all();
					const rows = res.results || [];
					return { content: rows.map((r:any)=>({ type:"text", text:`${r.conference} (${r.month}) – ${r.talks} talks` })) } as any;
				}
				if (list === "speakers") {
					let sql = `SELECT speaker, COUNT(*) AS talks FROM conference_talks`;
					const binds:any[] = [];
					if (conference) { sql += ` WHERE conference LIKE ?`; binds.push(`%${conference.trim()}%`); }
					sql += ` GROUP BY speaker ORDER BY talks DESC, speaker ASC LIMIT ?;`;
					binds.push(lim);
					const res = await getDB().prepare(sql).bind(...binds).all();
					const rows = res.results || [];
					return { content: rows.map((r:any)=>({ type:"text", text:`${r.speaker} (${r.talks})` })) } as any;
				}
				// Get by id
				if (id) {
					const row = await getDB().prepare(`SELECT id, speaker, title, conference, date, ${full?"full_text":"substr(full_text,1,1500) AS excerpt"} FROM conference_talks WHERE id=?;`).bind(id).first();
					if (!row) return { content: [{ type:"text", text:"Talk not found." }] } as any;
					const body = full ? (row as any).full_text : (row as any).excerpt;
					return { content: [
						{ type:"text", text:`${(row as any).speaker} – ${(row as any).title} (${(row as any).conference}, ${(row as any).date})${full?" (full)":""}` },
						{ type:"text", text: body }
					] } as any;
				}
				// Search (full-text) if query provided
				if (query) {
					let filter = ""; const binds:any[] = [];
					if (speaker) { filter += " AND speaker = ?"; binds.push(speaker); }
					if (conference) { filter += " AND conference LIKE ?"; binds.push(`%${conference.trim()}%`); }
					const sanitized = query.toLowerCase().replace(/[%_]/g, "");
					const like = `%${sanitized}%`;
					const stmt = getDB().prepare(`SELECT id, speaker, title, conference, date, substr(full_text, instr(lower(full_text), lower(?)) - 40, 200) AS snippet FROM conference_talks WHERE lower(full_text) LIKE ? ${filter} ORDER BY date DESC LIMIT ?;`).bind(query, like, ...binds, lim);
					const rows = (await stmt.all()).results || [];
					if (!rows.length) return { content: [{ type:"text", text:"No results. Try adjusting speaker/conference or list available conferences with talks{list:'conferences'}." }] } as any;
					return { content: rows.map((r:any)=>({ type:"text", text:`#${r.id} ${r.speaker} – ${r.title} (${r.conference} ${r.date}) ${r.snippet||''}` })) } as any;
				}
				// Structured filter (no query)
				if (speaker || conference || title) {
					let sql = `SELECT id, speaker, title, conference, date FROM conference_talks WHERE 1=1`;
					const binds:any[] = [];
					if (speaker) { sql += ` AND speaker = ?`; binds.push(speaker); }
					if (conference) { sql += ` AND conference LIKE ?`; binds.push(`%${conference.trim()}%`); }
					if (title) { sql += ` AND lower(title) LIKE ?`; binds.push(`%${title.toLowerCase()}%`); }
					sql += ` ORDER BY date LIMIT ?`; binds.push(lim);
					const res = await getDB().prepare(sql).bind(...binds).all();
					const rows = res.results || [];
					if (!rows.length) return { content: [{ type:"text", text:"No talks matched filters. Consider adding query for content search or list conferences." }] } as any;
					return { content: rows.map((r:any)=>({ type:"text", text:`#${r.id} ${r.date} – ${r.speaker}: ${r.title} (${r.conference})` })) } as any;
				}
				return { content: [{ type:"text", text:"Specify id to fetch a talk, query for full-text search, filters (speaker/conference/title), or list ('conferences'|'speakers')." }] } as any;
			});

			// (Deprecated conference tools removed; replaced entirely by talks tool.)

			MyMCP.sharedServer = server;
		}
		this.server = MyMCP.sharedServer!;
	}

	// Abstract method required by base; registration handled in constructor.
	async init(): Promise<void> { /* no-op */ }
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return (MyMCP as any).serveSSE("/sse").fetch(request, env, ctx);
		}
		if (url.pathname === "/mcp") {
			return (MyMCP as any).serve("/mcp").fetch(request, env, ctx);
		}
		return new Response("Not found", { status: 404 });
	}
};
