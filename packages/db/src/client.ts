import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDatabase(url: string) {
  const client = postgres(url, { max: 1, prepare: false });
  return { client, db: drizzle(client, { schema }) };
}
