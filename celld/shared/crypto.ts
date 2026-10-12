const encoder = new TextEncoder();
export const bytes = (s: string) => encoder.encode(s);
export function base64(b: Uint8Array): string {
  return btoa(Array.from(b, (n) => String.fromCharCode(n)).join(""));
}
export function unbase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export const token = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const base64url = (b: Uint8Array) =>
  base64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function hash(s: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(s))),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
function keyBytes(key: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key))
    throw new Error("MESSAGE_KEY must be a base64 encoded 32-byte secret");
  const b = unbase64(key);
  if (b.length !== 32 || base64(b) !== key)
    throw new Error("Invalid MESSAGE_KEY");
  return b;
}
export async function encrypt(text: string, key: string, roomId: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    keyBytes(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: bytes(roomId), tagLength: 128 },
      k,
      bytes(text),
    ),
  );
  return [iv, sealed.slice(-16), sealed.slice(0, -16)].map(base64).join(".");
}
export async function decrypt(value: string, key: string, roomId: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid ciphertext");
  const [iv, tag, body] = parts.map(unbase64);
  const sealed = new Uint8Array(body!.length + tag!.length);
  sealed.set(body!);
  sealed.set(tag!, body!.length);
  const k = await crypto.subtle.importKey(
    "raw",
    keyBytes(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv!,
        additionalData: bytes(roomId),
        tagLength: 128,
      },
      k,
      sealed,
    ),
  );
}
export const normalized = (s: string) =>
  s.toLocaleLowerCase().replace(/\s+/g, " ").trim();
export async function fingerprint(text: string, key: string, roomId: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    keyBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", k, bytes(roomId + normalized(text))),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function meaningful(
  text: string,
  lastAt: string | null,
  now = Date.now(),
) {
  const n = normalized(text);
  return (
    n.length >= 8 &&
    new Set(n).size >= 4 &&
    (!lastAt || now - Date.parse(lastAt) >= 3000)
  );
}
export async function capabilityKey(key: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    keyBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", k, bytes("charoo/media-capabilities/v1")),
  );
}
