import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class Db implements OnModuleDestroy {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...(process.env.ORBIT_PLUGIN_SETTINGS_MODE === 'participant' ? { connectionTimeoutMillis: 3000 } : {}),
  });
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }
  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
