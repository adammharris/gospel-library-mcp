// Minimal stubs so Node build doesn't error on Cloudflare specific types.
// These are intentionally partial.
interface D1PreparedStatement {
  bind(...args: any[]): D1PreparedStatement;
  all(): Promise<{ results: any[] }>
  first(): Promise<any>
  run(): Promise<any>
  raw(): Promise<any[]>
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface DurableObjectState {}
interface Env {}
interface ExecutionContext {}
