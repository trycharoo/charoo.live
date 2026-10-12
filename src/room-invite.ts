export function roomTokenFromUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Paste a room invitation URL to continue.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(
      "Enter a complete invitation URL starting with https:// or http://.",
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Enter a complete invitation URL starting with https:// or http://.",
    );
  }
  const tokens = new URLSearchParams(url.hash.slice(1)).getAll("room");
  if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tokens[0])) {
    throw new Error(
      "This URL doesn’t contain a valid room invitation. Ask the host for the full link.",
    );
  }
  return tokens[0];
}
