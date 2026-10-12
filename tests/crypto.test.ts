import { expect, it } from "vitest";
import { createCipheriv } from "node:crypto";
import {
  encrypt,
  decrypt,
  fingerprint,
  meaningful,
} from "../celld/shared/crypto";
const key = btoa("x".repeat(32));
it("retains AES-256-GCM iv.tag.body compatibility with the Node backend", async () => {
  const iv = new Uint8Array(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(Buffer.from("room-a"));
  const ciphertext = Buffer.concat([
    cipher.update("private message", "utf8"),
    cipher.final(),
  ]);
  const value = [Buffer.from(iv), Buffer.from(cipher.getAuthTag()), ciphertext]
    .map((p) => p.toString("base64"))
    .join(".");
  expect(await decrypt(value, key, "room-a")).toBe("private message");
  expect(
    await decrypt(
      await encrypt("private message", key, "room-a"),
      key,
      "room-a",
    ),
  ).toBe("private message");
});
it("rejects modified ciphertext, tags, room authenticated data and wrong keys", async () => {
  const ciphertext = await encrypt("private message", key, "room-a");
  await expect(decrypt(ciphertext, key, "room-b")).rejects.toThrow();
  await expect(
    decrypt(ciphertext, btoa("y".repeat(32)), "room-a"),
  ).rejects.toThrow();
  const parts = ciphertext.split(".");
  parts[1] = btoa("z".repeat(16));
  await expect(decrypt(parts.join("."), key, "room-a")).rejects.toThrow();
  await expect(decrypt("bad", key, "room-a")).rejects.toThrow();
});
it("normalizes qualifying-message fingerprints and keeps rooms separate", async () => {
  expect(await fingerprint(" Hello   FRIEND ", key, "a")).toBe(
    await fingerprint("hello friend", key, "a"),
  );
  expect(await fingerprint("hello friend", key, "a")).not.toBe(
    await fingerprint("hello friend", key, "b"),
  );
  expect(meaningful("aaaaaaaaaaaaaaaa", null)).toBe(false);
  expect(meaningful("hello friend", new Date().toISOString())).toBe(false);
});
