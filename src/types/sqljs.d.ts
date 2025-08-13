declare module 'sql.js' {
  interface SqlJsDatabase {
    prepare(sql: string): any;
    exec?(sql: string): any;
    close?(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }
  const init: (config?: any) => Promise<SqlJsStatic>;
  export default init;
}
