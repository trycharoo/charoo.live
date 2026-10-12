import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";

const filename = process.env.CELLD_ENV_FILE || ".env";
const previous = existsSync(filename) ? readFileSync(filename, "utf8") : "";
const values = parse(previous);
const defaults = {
  NODE_ENV: "development",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  MESSAGE_KEY: Buffer.from(randomBytes(32)).toString("base64"),
  EMAIL_FROM: "Charoo <hello@localhost>",
  MAILPIT_URL: "http://127.0.0.1:8025",
};
const missing = Object.entries(defaults).filter(([name]) => !values[name]);
if (missing.length)
  writeFileSync(
    filename,
    previous +
      (previous.endsWith("\n") || !previous ? "" : "\n") +
      missing
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
console.log(
  `Local configuration ready in ${filename}. Start Mailpit separately to enable email sign-in.`,
);
