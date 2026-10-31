import schema from "../migrations/0001_charoo.sql";
import indexes from "../migrations/0002_indexes.sql";
import emailNavigation from "../migrations/0003_email_navigation.sql";
import quickChatArchives from "../migrations/0004_quick_chat_archives.sql";
import type { Env } from "../env";
import { defaultSettings } from "@charoo/contracts";
import { first, run } from "./data";
export async function ensureSchema(env: Env) {
  const migrations = [
    ["0001_charoo.sql", schema],
    ["0002_indexes.sql", indexes],
    ["0003_email_navigation.sql", emailNavigation],
    ["0004_quick_chat_archives.sql", quickChatArchives],
  ] as const;
  if (env.NODE_ENV === "production") {
    let ready = false;
    try {
      ready =
        Number(
          (
            await first(
              env,
              `SELECT count(*) AS n FROM d1_migrations WHERE name IN (${migrations.map(() => "?").join(",")})`,
              migrations.map((m) => m[0]),
            )
          )?.n,
        ) === migrations.length;
    } catch {}
    if (!ready) throw new Error("DATABASE_NOT_MIGRATED");
  } else {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const [name, sql] of migrations)
      if (
        !(await first(env, "SELECT 1 FROM d1_migrations WHERE name=?", [name]))
      )
        await env.DB.exec(
          sql + `\nINSERT INTO d1_migrations(name) VALUES('${name}');`,
        );
  }
  await run(
    env,
    "INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(defaultSettings)],
  );
}
