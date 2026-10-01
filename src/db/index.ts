import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const hasDbConfig = Boolean(process.env.DATABASE_URL || process.env.SQL_HOST);

export const createPool = (): any => {
  if (!global._postgresPool) {
    if (process.env.DATABASE_URL) {
      global._postgresPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 5000,
      });
    } else if (process.env.SQL_HOST) {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 5000,
      });
    } else {
      // Mock pool per AI Studio web migration guidelines
      console.warn('[AI Studio] Database credentials not set — using in-memory mock fallback');
      const noOpClient = {
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      };
      global._postgresPool = {
        query: async () => ({ rows: [], rowCount: 0 }),
        connect: async () => noOpClient,
        on: () => {},
      } as any;
    }

    if (global._postgresPool && typeof (global._postgresPool as any).on === 'function') {
      (global._postgresPool as any).on('error', (err: any) => {
        console.warn('PostgreSQL pool connection event:', err?.message || err);
      });
    }
  }
  return global._postgresPool;
};

const pool = createPool();

let dbInstance: any;
try {
  dbInstance = drizzle(pool, { schema });
} catch {
  console.warn('[AI Studio] Database not connected — using mock proxy');
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
  };
  dbInstance = new Proxy({}, {
    get: (_, prop) => prop === 'query' ? new Proxy({}, { get: () => noOp }) : async () => [],
  });
}

export const db = dbInstance;
export { pool, hasDbConfig };
