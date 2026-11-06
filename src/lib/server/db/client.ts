import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

interface DbHolder {
  db: Db;
  sqlite: Database.Database;
  file: string;
}

const g = globalThis as typeof globalThis & { __axiometerDb?: DbHolder };

function migrationsFolder(): string {
  // `drizzle/` sits at the project root in dev and is copied next to server.js in the Docker image.
  const candidates = [process.env.MIGRATIONS_DIR, path.join(process.cwd(), "drizzle")].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => fs.existsSync(path.join(/*turbopackIgnore: true*/ p, "meta", "_journal.json")));
  if (!found) throw new Error(`Drizzle migrations folder not found (looked in ${candidates.join(", ")})`);
  return found;
}

/** Open a database (":memory:" for tests) and apply migrations. */
export function openDb(file: string): DbHolder {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ file)), { recursive: true });
  const sqlite = new Database(/*turbopackIgnore: true*/ file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, sqlite, file };
}

/** Process-wide singleton (survives dev hot reload). */
export function getDb(): Db {
  if (!g.__axiometerDb) {
    const file = process.env.DATABASE_PATH || "./data/axiometer.db";
    g.__axiometerDb = openDb(file);
    console.info(`[db] opened ${path.resolve(/*turbopackIgnore: true*/ file)}`);
  }
  return g.__axiometerDb.db;
}
