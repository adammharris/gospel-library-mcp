// STDIO MCP server entrypoint so model clients can launch with just: node dist/stdio-server.js
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './shared-tools.js';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

// Local DB shim identical to node-core but minimal (reuse logic by lazy dynamic import of node-core for DB init)
let db: any = null;
async function ensureDb() {
  if (db) return;
  const envPath = process.env.GOSPEL_DB_PATH;
  const candidate = envPath ? envPath : 'gospel-library.db';
  const absPath = path.isAbsolute(candidate) ? candidate : path.join(process.cwd(), candidate);
  if (!fs.existsSync(absPath)) {
    throw new Error(`SQLite file not found at ${absPath} (set GOSPEL_DB_PATH or place gospel-library.db in project root).`);
  }
  // Helper to build a uniform statement wrapper
  const wrap = (runner: (sql: string, args: any[]) => { all: () => any[]; first: () => any }) => ({
    prepare(sql: string) {
      let bindArgs: any[] = [];
      const api: any = {
        bind(...args: any[]) { bindArgs = args; return api; },
        async all() { const { all } = runner(sql, bindArgs); return { results: all() }; },
        async first() { const { first } = runner(sql, bindArgs); return first(); },
        async run() { return { success: false }; },
        async raw() { return []; }
      };
      return api;
    }
  });
  const forced = (process.env.GOSPEL_DB_BACKEND || '').toLowerCase();
  // Try better-sqlite3 unless forced to something else
  if (!forced || forced === 'better' || forced === 'native') {
    try {
      const BetterSqlite = (await import('better-sqlite3')).default;
      const native = new BetterSqlite(absPath, { readonly: true });
      db = wrap((sql, args) => {
        const stmt = native.prepare(sql);
        if (args.length) stmt.bind(...args);
        return {
          all: () => stmt.all(),
          first: () => stmt.get()
        };
      });
      console.error(`[gospel-library] using better-sqlite3 backend at ${absPath}`);
      return;
    } catch (e) { console.error('[gospel-library] better-sqlite3 unavailable', (e as any)?.message); }
  }
  // Bun
  if (!forced || forced === 'bun') {
    try {
      // @ts-ignore Bun global
      if (typeof Bun !== 'undefined') {
        // @ts-ignore
        const { Database } = await import('bun:sqlite');
        const sqlite = new Database(absPath, { readOnly: true });
        db = wrap((sql, args) => {
          const stmt = sqlite.query(sql);
          const bound = args.length ? stmt.bind(...args) : stmt;
          return {
            all: () => bound.all(),
            first: () => bound.get()
          };
        });
        console.error(`[gospel-library] using bun:sqlite backend at ${absPath}`);
        return;
      }
    } catch (e) { console.error('[gospel-library] bun:sqlite unavailable', (e as any)?.message); }
  }
  // sql.js fallback (pure WASM, slower but portable)
  if (!forced || forced === 'sqljs' || forced === 'sql.js' || forced === 'wasm') {
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const fileBuffer = fs.readFileSync(absPath);
      const sqlDb = new SQL.Database(fileBuffer);
      db = wrap((sql, args) => {
        return {
          all: () => {
            const stmt = sqlDb.prepare(sql);
            if (args.length) stmt.bind(args);
            const rows: any[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
          },
          first: () => {
            const stmt = sqlDb.prepare(sql);
            if (args.length) stmt.bind(args);
            let row: any = null;
            if (stmt.step()) row = stmt.getAsObject();
            stmt.free();
            return row;
          }
        };
      });
      console.error(`[gospel-library] using sql.js backend at ${absPath}`);
      return;
    } catch (e) {
      if (forced && (forced === 'sqljs' || forced === 'sql.js' || forced === 'wasm')) {
        throw new Error(`Forced sql.js backend failed: ${e instanceof Error? e.message : e}`);
      }
      console.error('[gospel-library] sql.js unavailable', (e as any)?.message);
    }
  }
  throw new Error('No viable SQLite backend initialized (tried better-sqlite3, bun:sqlite, sql.js)');
}
function getDB() { if (!db) throw new Error('DB not initialized'); return db; }

async function main() {
  const transport = new StdioServerTransport(process.stdin, process.stdout);
  const server = new McpServer({ name: 'gospel-library', version: '0.1.0-stdio' });
  if (process.env.GOSPEL_DEBUG) console.error('[gospel-library] starting stdio server');
  await ensureDb();
  registerAllTools(server, { ensureDb, getDB });
  await server.connect(transport);
  // Keep process alive; on stdin end we exit.
  process.stdin.resume();
}

main().catch(err => {
  console.error('Fatal stdio server error', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason:any) => {
  console.error('[gospel-library] unhandledRejection', reason);
});
process.on('uncaughtException', err => {
  console.error('[gospel-library] uncaughtException', err);
});
