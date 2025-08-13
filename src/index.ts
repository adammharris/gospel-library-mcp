import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./shared-tools.js";
// Node fallback: declare require if not typed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare var require: any;

// DB binding is present in Cloudflare; for local dev we fallback to a sqlite file if missing.
interface EnvWithDB extends Env { DB?: D1Database }

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
			registerAllTools(server, {
				ensureDb: async () => {
					if (!MyMCP.db) { await ensureLocalDB(); if (!MyMCP.db && env.DB) MyMCP.db = env.DB; }
				},
				getDB: () => {
					if (!MyMCP.db) throw new Error("DB not initialized (no D1 binding and local sqlite not loaded)");
					return MyMCP.db;
				}
			});
			MyMCP.sharedServer = server;
		}
		this.server = MyMCP.sharedServer!;
	}

	// Abstract method required by base; registration handled in constructor.
	async init(): Promise<void> { /* no-op */ }
}

// Lazy local sqlite initialization (only in Bun local dev)
async function ensureLocalDB() {
	if (MyMCP.db) return;
	// Try Node environment first (better-sqlite3)
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const BetterSqlite = require('better-sqlite3');
		const dbFile = 'gospel-library.db';
		const native = new BetterSqlite(dbFile, { readonly: true });
		MyMCP.db = {
			prepare(sql: string) {
				return {
					bind(...args: any[]) {
						const stmt = native.prepare(sql);
						if (args.length) stmt.bind(...args);
						return {
							async all() { return { results: stmt.all() }; },
							async first() { return stmt.get(); },
							async run() { return { success: false }; },
							async raw() { return []; }
						};
					}
				};
			}
		} as any;
		return;
	} catch (_) { /* ignore and try Bun */ }
	// Bun fallback
	try {
		// @ts-ignore Bun global
		if (typeof Bun !== 'undefined') {
			// @ts-ignore
			const { Database } = await import('bun:sqlite');
			const sqlite = new Database('gospel-library.db', { readOnly: true });
			MyMCP.db = {
				prepare(sql: string) {
					return {
						bind(...args: any[]) {
							const stmt = args.length ? sqlite.query(sql).bind(...args) : sqlite.query(sql);
							return {
								async all() { return { results: stmt.all() }; },
								async first() { return stmt.get(); },
								async run() { return { success: false }; },
								async raw() { return []; }
							};
						}
					};
				}
			} as any;
		}
	} catch (e) {
		console.warn('Failed local sqlite initialization (Node & Bun)', e);
	}
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

// Helper for Node wrapper to ensure shared server is initialized (and local DB attempted)
export async function getLocalServer() {
	if (!MyMCP.sharedServer) {
		// Create a dummy durable object state/env for initialization context.
		// @ts-ignore minimal stub objects; server logic only relies on constructor side-effects.
		new MyMCP({} , { DB: undefined } as any);
	}
	if (!MyMCP.db) {
		await ensureLocalDB();
	}
	return MyMCP.sharedServer!;
}
