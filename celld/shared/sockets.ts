// Celld 0.6.1 permits 1000 and application close codes, following the browser API.
export const revoked = 4001;
export function closeSocket(
  ws: WebSocket,
  code = revoked,
  reason = "Session unavailable",
) {
  try {
    ws.close(code, reason);
  } catch {}
}
export function sendSocket(ws: WebSocket, event: unknown) {
  if (
    ((ws as WebSocket & { bufferedAmount?: number }).bufferedAmount || 0) >
    256000
  ) {
    closeSocket(ws, 4003, "Reconnect to load history");
    return;
  }
  ws.send(JSON.stringify(event));
}
