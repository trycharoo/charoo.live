import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { writeFileSync, readFileSync } from "node:fs";
import { defaultSettings } from "@charoo/contracts";
const base = "http://127.0.0.1:9887",
  testHeaders = { "X-Test-Key": "charoo-native-fixture" };
async function identity(browser: Browser, verified = false, role = "USER") {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Fixture-Client": crypto.randomUUID() },
  });
  const response = await context.request.post(`${base}/__test/session`, {
    headers: testHeaders,
    data: { verified, role },
  });
  const session = await response.json();
  async function api(path: string, method = "GET", data?: unknown) {
    return context.request.fetch(`${base}/api${path}`, {
      method,
      data,
      headers: { Origin: base, "X-CSRF-Token": session.csrf },
    });
  }
  await api("/presence", "POST", { status: "Online" });
  return { context, session, api };
}
async function group(
  u: Awaited<ReturnType<typeof identity>>,
  title = "Native group",
) {
  const res = await u.api("/rooms", "POST", { type: "SHARED_GROUP", title });
  expect(res.status()).toBe(201);
  return res.json();
}
test("production assets, room sockets, REST writes and unauthorized socket activity", async ({
  browser,
}) => {
  const a = await identity(browser),
    b = await identity(browser),
    outsider = await identity(browser);
  try {
    const asset = await a.context.request.get(base);
    expect(asset.headers()["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    expect(asset.headers()["x-content-type-options"]).toBe("nosniff");
    const r = await group(a),
      token = new URL(r.shareUrl).hash.slice(6);
    expect((await b.api("/shared/join", "POST", { token })).status()).toBe(200);
    const page = await a.context.newPage();
    const socketFrames: string[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", (frame) => socketFrames.push(String(frame.payload))),
    );
    await page.goto(base);
    await expect(page.locator(".connection")).toHaveText("Live");
    await page
      .getByRole("button", { name: "Native group", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Native REST hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".messages").getByText("Native REST hello", { exact: true }),
    ).toBeVisible();
    expect(
      socketFrames.some((frame) => frame.includes('"type":"message"')),
    ).toBe(false);
    await b.api(`/rooms/${r.id}/messages`, "POST", {
      text: "Room socket update",
      clientMessageId: crypto.randomUUID(),
    });
    await expect(
      page
        .locator(".messages")
        .getByText("Room socket update", { exact: true }),
    ).toBeVisible({ timeout: 3000 });
    const otherPage = await outsider.context.newPage();
    await otherPage.goto(base);
    const opened = await otherPage.evaluate(
      (id) =>
        new Promise<boolean>((resolve) => {
          const socket = new WebSocket(
            `ws://${location.host}/api/rooms/${id}/socket`,
          );
          socket.onopen = () => {
            socket.close();
            resolve(true);
          };
          socket.onclose = () => resolve(false);
          setTimeout(() => resolve(false), 3000);
        }),
      r.id,
    );
    expect(opened).toBe(false);
    const invalid = await page.evaluate(
      (id) =>
        new Promise<number>((resolve) => {
          const socket = new WebSocket(
            `ws://${location.host}/api/rooms/${id}/socket`,
          );
          socket.onopen = () =>
            socket.send(
              JSON.stringify({
                type: "message",
                payload: { text: "Forged socket write" },
              }),
            );
          socket.onclose = (event) => resolve(event.code);
        }),
      r.id,
    );
    expect(invalid).toBe(4001);
    expect(
      (await (await a.api(`/rooms/${r.id}/messages`)).json()).messages,
    ).toHaveLength(2);
    expect(
      (await a.context.request.get(`${base}/manifest.webmanifest`)).status(),
    ).toBe(200);
  } finally {
    await a.context.close();
    await b.context.close();
    await outsider.context.close();
  }
});
test("email upgrades keep the identity, rotate sessions and consume links once", async ({
  browser,
}) => {
  const a = await identity(browser);
  try {
    const email = `${crypto.randomUUID()}@fixture.example`;
    expect(
      (
        await a.api("/auth/email", "POST", { email, communityConsent: true })
      ).status(),
    ).toBe(200);
    const state = await (
      await a.context.request.get("http://127.0.0.1:8026/state")
    ).json();
    const sent = state.mail.find((m: any) => m.To[0].Email === email);
    const token = /#verify=([A-Za-z0-9_-]+)/.exec(sent.Text)![1];
    // A fresh page has no in-memory CSRF token. A one-use mailbox capability still completes sign-in.
    const verified = await a.context.request.post(`${base}/api/auth/verify`, {
      headers: { Origin: base },
      data: { token },
    });
    expect(verified.status()).toBe(200);
    const result = await verified.json();
    expect(result.user.id).toBe(a.session.user.id);
    expect(result.user.verified).toBe(true);
    expect(
      (
        await a.context.request.get(`${base}/api/me`, {
          headers: { Cookie: `charoo_session=${a.session.token}` },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await a.context.request.post(`${base}/api/auth/verify`, {
          headers: { Origin: base },
          data: { token },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await a.context.close();
  }
});
test("email sign-in returns to the invited room in the browser", async ({
  browser,
}) => {
  const host = await identity(browser),
    guest = await identity(browser);
  try {
    const room = await group(host, "Email invitation room");
    const roomToken = new URL(room.shareUrl).hash.slice(6);
    const email = `${crypto.randomUUID()}@fixture.example`;
    expect(
      (
        await guest.api("/auth/email", "POST", {
          email,
          communityConsent: true,
          roomToken,
        })
      ).status(),
    ).toBe(200);
    const state = await (
      await guest.context.request.get("http://127.0.0.1:8026/state")
    ).json();
    const sent = state.mail.find((m: any) => m.To[0].Email === email);
    const link = sent.Text.match(/http[^\s]+/)[0];
    expect(new URL(link).hash).toContain(`room=${roomToken}`);
    const page = await guest.context.newPage();
    await page.goto(link);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByLabel("Nickname", { exact: true })
      .fill("Email room friend");
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Email invitation room", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".messages")).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    const me = await (await guest.context.request.get(`${base}/api/me`)).json();
    expect(me.user).toMatchObject({
      id: guest.session.user.id,
      verified: true,
      displayName: "Email room friend",
    });
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
test("Google cancellation preserves browser binding, PKCE and invitation navigation", async ({
  browser,
}) => {
  const a = await identity(browser);
  try {
    const token = "a".repeat(43),
      start = await (
        await a.api("/auth/google", "POST", {
          communityConsent: true,
          roomToken: token,
        })
      ).json(),
      url = new URL(start.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    const callback = `/api/auth/google/callback?state=${url.searchParams.get("state")}&error=access_denied`,
      response = await a.context.request.get(`${base}${callback}`, {
        maxRedirects: 0,
      });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toContain(`room=${token}`);
    expect(response.headers().location).toContain("authError=cancelled");
    expect(
      (
        await a.context.request.get(`${base}${callback}`, { maxRedirects: 0 })
      ).headers().location,
    ).toContain("authError=expired");
  } finally {
    await a.context.close();
  }
});
test("concurrent room limits, matching, cancellation and contact acceptance", async ({
  browser,
}) => {
  const a = await identity(browser, true),
    b = await identity(browser, true),
    waiting = await identity(browser, true);
  try {
    const creations = await Promise.all(
      Array.from({ length: 6 }, () =>
        a.api("/rooms", "POST", {
          type: "AVAILABLE_TONIGHT",
          title: "Native public group",
        }),
      ),
    );
    expect(creations.filter((r) => r.status() === 201)).toHaveLength(3);
    expect(creations.filter((r) => r.status() === 429)).toHaveLength(3);
    expect((await (await a.api("/match", "POST", {})).json()).queued).toBe(
      true,
    );
    const matched = await (await b.api("/match", "POST", {})).json();
    expect(matched.roomId).toBeTruthy();
    const request = await (
      await a.api("/requests", "POST", {
        kind: "CONTACT",
        targetId: b.session.user.id,
        roomId: matched.roomId,
      })
    ).json();
    const accepted = await Promise.all(
      Array.from({ length: 4 }, () =>
        b.api(`/requests/${request.id}/respond`, "POST", { accept: true }),
      ),
    );
    const results = await Promise.all(accepted.map((r) => r.json()));
    expect(new Set(results.map((r) => r.roomId)).size).toBe(1);
    expect(await (await a.api("/contacts")).json()).toHaveLength(1);
    await waiting.api("/match", "POST", {});
    expect((await waiting.api("/match", "DELETE")).status()).toBe(204);
    const contactRoom = results[0].roomId;
    await a.api("/blocks", "POST", { targetId: b.session.user.id });
    expect((await a.api(`/rooms/${contactRoom}/messages`)).status()).toBe(403);
    await a.api(`/blocks/${b.session.user.id}`, "DELETE");
    await a.api(`/contacts/${b.session.user.id}`, "DELETE");
    expect((await b.api(`/rooms/${contactRoom}/messages`)).status()).toBe(410);
  } finally {
    await a.context.close();
    await b.context.close();
    await waiting.context.close();
  }
});
test("R2 quarantine, scanning retries, scoped URLs and authenticated downloads", async ({
  browser,
}) => {
  const a = await identity(browser),
    outsider = await identity(browser);
  try {
    const r = await group(a),
      file = await (
        await a.api("/media/init", "POST", {
          roomId: r.id,
          name: "image.png",
          mime: "image/png",
          size: 10,
        })
      ).json();
    expect(
      (
        await outsider.api(
          `/media/${file.id}/upload`,
          "PUT",
          Buffer.from("0123456789"),
        )
      ).status(),
    ).toBe(404);
    const upload = await a.context.request.put(`${base}${file.url}`, {
      headers: {
        Origin: base,
        "X-CSRF-Token": a.session.csrf,
        "Content-Type": "image/png",
      },
      data: Buffer.from("0123456789"),
    });
    expect(upload.status()).toBe(204);
    expect((await a.api(`/media/${file.id}/download`)).status()).toBe(404);
    await a.context.request.post("http://127.0.0.1:8026/control", {
      data: { scannerFail: true },
    });
    expect(
      (await a.api(`/media/${file.id}/complete`, "POST", {})).status(),
    ).toBe(503);
    await a.context.request.post("http://127.0.0.1:8026/control", {
      data: { scannerFail: false },
    });
    expect(
      (await a.api(`/media/${file.id}/complete`, "POST", {})).status(),
    ).toBe(200);
    const state = await (
        await a.context.request.get("http://127.0.0.1:8026/state")
      ).json(),
      scan = state.scans.at(-1);
    expect((await a.context.request.get(scan.url)).status()).toBe(403);
    expect(
      (await a.api(`/media/${file.id}/complete`, "POST", {})).status(),
    ).toBe(200);
    const download = await (await a.api(`/media/${file.id}/download`)).json();
    expect(
      (await a.context.request.get(`${base}${download.url}`)).status(),
    ).toBe(200);
    expect(
      (await outsider.context.request.get(`${base}${download.url}`)).status(),
    ).toBe(404);
    const anonymous = await browser.newContext();
    expect(
      (await anonymous.request.get(`${base}${download.url}`)).status(),
    ).toBe(401);
    await anonymous.close();
  } finally {
    await a.context.close();
    await outsider.context.close();
  }
});
test("call consent, AI privacy, reports, audited evidence and staff permissions", async ({
  browser,
}) => {
  const a = await identity(browser, true),
    b = await identity(browser, true),
    admin = await identity(browser, true, "ADMIN"),
    support = await identity(browser, true, "SUPPORT");
  try {
    expect(
      (
        await admin.api("/admin/settings", "PATCH", {
          ...defaultSettings,
          video_enabled: true,
          AI_assistant_enabled: true,
        })
      ).status(),
    ).toBe(200);
    await a.api("/match", "POST", {});
    const matched = await (await b.api("/match", "POST", {})).json();
    const roomId = matched.roomId;
    const message = await (
      await a.api(`/rooms/${roomId}/messages`, "POST", {
        text: "Private message for evidence",
        clientMessageId: crypto.randomUUID(),
      })
    ).json();
    expect(
      (
        await a.api("/assistant", "POST", { roomId, style: "icebreaker" })
      ).status(),
    ).toBe(200);
    const state = await (
      await a.context.request.get("http://127.0.0.1:8026/state")
    ).json();
    expect(JSON.stringify(state.ai)).not.toContain(
      "Private message for evidence",
    );
    const call = await (
      await a.api("/calls", "POST", { roomId, targetId: b.session.user.id })
    ).json();
    expect((await a.api(`/calls/${call.id}/token`, "POST", {})).status()).toBe(
      403,
    );
    expect(
      (
        await b.api(`/calls/${call.id}/respond`, "POST", { accept: true })
      ).status(),
    ).toBe(204);
    expect((await a.api(`/calls/${call.id}/token`, "POST", {})).status()).toBe(
      200,
    );
    await a.context.request.post("http://127.0.0.1:8026/control", {
      data: { livekitFail: true },
    });
    expect((await a.api(`/calls/${call.id}/end`, "POST", {})).status()).toBe(
      204,
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await a.context.request.get("http://127.0.0.1:8026/state")
            ).json()
          ).terminations.length,
      )
      .toBeGreaterThan(0);
    await a.context.request.post("http://127.0.0.1:8026/control", {
      data: { livekitFail: false },
    });
    await a.api(`/calls/${call.id}/end`, "POST", {});
    expect(
      (
        await b.api("/reports", "POST", {
          roomId,
          messageId: message.id,
          reason: "Please review this message",
        })
      ).status(),
    ).toBe(201);
    const reports = await (await admin.api("/admin/reports")).json(),
      report = reports.find((r: any) => r.message_id === message.id);
    expect(
      (await support.api(`/admin/reports/${report.id}/evidence`)).status(),
    ).toBe(403);
    expect(
      (await (await admin.api(`/admin/reports/${report.id}/evidence`)).json())
        .text,
    ).toBe("Private message for evidence");
    expect(
      (await (await admin.api("/admin/audit")).json()).some(
        (r: any) => r.action === "report.evidence.read",
      ),
    ).toBe(true);
    expect(
      (
        await support.api("/admin/actions", "POST", {
          action: "BAN",
          targetId: a.session.user.id,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.api("/admin/actions", "POST", {
          action: "BAN",
          targetId: support.session.user.id,
        })
      ).status(),
    ).toBe(403);
    await a.context.request.post(`${base}/__test/room`, {
      headers: testHeaders,
      data: { id: roomId, action: "expire" },
    });
    expect((await a.api(`/rooms/${roomId}/messages`)).status()).toBe(410);
  } finally {
    await a.context.close();
    await b.context.close();
    await admin.context.close();
    await support.context.close();
  }
});
test("prepare restart persistence", async ({ browser }) => {
  const a = await identity(browser);
  try {
    const r = await group(a, "Restart room");
    const message = {
      text: "Persist across a Celld restart",
      clientMessageId: crypto.randomUUID(),
    };
    expect(
      (await a.api(`/rooms/${r.id}/messages`, "POST", message)).status(),
    ).toBe(201);
    writeFileSync(
      ".context/native-restart.json",
      JSON.stringify({ room: r, session: a.session, message }),
    );
  } finally {
    await a.context.close();
  }
});
test("verify restart persistence", async ({ request }) => {
  const saved = JSON.parse(
    readFileSync(".context/native-restart.json", "utf8"),
  );
  const response = await request.get(
    `${base}/api/rooms/${saved.room.id}/messages`,
    {
      headers: {
        Cookie: `charoo_session=${saved.session.token}`,
        "X-Fixture-Client": "restart-client",
      },
    },
  );
  expect(response.status()).toBe(200);
  expect((await response.json()).messages[0].text).toBe(saved.message.text);
});
