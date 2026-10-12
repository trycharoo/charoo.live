import { createServer } from "node:http";
import { jwtVerify } from "jose";
const state = {
  mail: [] as any[],
  scans: [] as any[],
  ai: [] as any[],
  terminations: [] as any[],
  scannerFail: false,
  scannerSafe: true,
  livekitFail: false,
};
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/state") {
      response.end(JSON.stringify(state));
      return;
    }
    if (request.url === "/control") {
      Object.assign(state, body);
      response.end("{}");
      return;
    }
    if (request.url === "/api/v1/send") {
      state.mail.push(body);
      response.end("{}");
      return;
    }
    if (request.url === "/scan") {
      state.scans.push(body);
      if (state.scannerFail) {
        response.statusCode = 503;
        response.end("{}");
        return;
      }
      if (request.headers.authorization !== "Bearer fixture-scanner-secret")
        throw new Error("Missing scanner authentication");
      const object = await fetch(body.url);
      if (!object.ok) throw new Error("Invalid scanner read capability");
      const bytes = await object.arrayBuffer();
      const output = await fetch(body.writeUrl, {
        method: "PUT",
        headers: { "Content-Type": body.mime },
        body: bytes,
      });
      if (!output.ok) throw new Error("Invalid scanner write capability");
      response.end(
        JSON.stringify({
          clean: state.scannerSafe,
          magicBytesValid: true,
          metadataStripped: true,
          contentSafe: state.scannerSafe,
        }),
      );
      return;
    }
    if (request.url === "/v1/chat/completions") {
      state.ai.push(body);
      response.end(
        JSON.stringify({
          choices: [{ message: { content: "What made you smile today?" } }],
        }),
      );
      return;
    }
    if (request.url === "/twirp/livekit.RoomService/DeleteRoom") {
      const jwt = request.headers.authorization?.slice(7) || "",
        claims = await jwtVerify(
          jwt,
          new TextEncoder().encode("fixture-livekit-secret"),
          { issuer: "fixture-livekit-key" },
        );
      if (!(claims.payload.video as any)?.roomAdmin)
        throw new Error("Invalid LiveKit grant");
      state.terminations.push(body);
      response.statusCode = state.livekitFail ? 503 : 200;
      response.end("{}");
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  } catch {
    response.statusCode = 500;
    response.end('{"error":"Fixture provider error"}');
  }
});
server.listen(8026, "127.0.0.1", () =>
  console.log("Fixture providers ready on 8026"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit()));
