declare module 'better-sqlite3' {
  interface Statement {
    bind(...params: any[]): Statement;
    all(...params: any[]): any[];
    get(...params: any[]): any;
  }
  interface Database {
    prepare(sql: string): Statement;
    close(): void;
  }
  const Constructor: {
    new(path: string, opts?: any): Database;
  };
  export default Constructor;
}
