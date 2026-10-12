import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { native } from "./cli";

const [id, role, ...args] = process.argv.slice(2);
const input = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    role: z.enum(["USER", "SUPPORT", "MODERATOR", "ADMIN"]),
  })
  .parse({ id, role });
const directory = mkdtempSync(join(tmpdir(), "charoo-role-")),
  file = join(directory, "grant.sql");
// Values are UUIDs and a fixed enum; no public HTTP route can grant staff roles.
writeFileSync(
  file,
  `UPDATE users SET role='${input.role}' WHERE id='${input.id}' AND verified=1;\nINSERT INTO audit_logs(id,actor_id,action,target_id,details,created_at) SELECT '${crypto.randomUUID()}',NULL,'operator.role','${input.id}','{"role":"${input.role}"}',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE id='${input.id}' AND verified=1;\n`,
  { mode: 0o600 },
);
try {
  process.exitCode = await native([
    "d1",
    "execute",
    "charoo",
    "--file",
    file,
    ".",
    ...args.filter((arg) => arg !== "--"),
  ]);
} finally {
  rmSync(directory, { recursive: true });
}
