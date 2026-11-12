import { expect, test, type Page } from "@playwright/test";
import { visualFixture, visualIds } from "./visual-fixture";

const roomUrl = `/api/rooms/${visualIds.group}`;
function snapshot(options: { count?: number; hasPicture?: boolean } = {}) {
  const count = options.count ?? 10;
  return {
    id: visualIds.group,
    type: "STRANGER",
    title: "Quick chat",
    state: "OPEN",
    online: 2,
    asl_revealed: count >= 5,
    participants: [
      { id: visualIds.user, name: "Stranger", verified: true, asl: null },
      {
        id: visualIds.peer,
        name: "Stranger",
        verified: true,
        asl: count >= 5 ? { age: 31, gender: "Woman", region: "Manila" } : null,
      },
    ],
    aslProgress: [
      { id: visualIds.user, count },
      { id: visualIds.peer, count },
    ],
    pictureSharing: {
      eligible: count >= 10,
      self: {
        hasPicture: options.hasPicture ?? true,
        decision: "pending" as "pending" | "declined" | "approved",
        pictureId: "60000000-0000-4000-8000-000000000001",
        previewUrl:
          "/api/profile/picture/content?pictureId=60000000-0000-4000-8000-000000000001",
      },
      participants: [] as { id: string; url: string }[],
    },
  };
}

async function openQuickChat(page: Page) {
  await page.route("**/api/profile/picture/content*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="16" fill="#e8dbca"/><circle cx="64" cy="46" r="20" fill="#8d765d"/><path d="M25 120c0-46 78-46 78 0" fill="#8d765d"/></svg>',
    }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Quick chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Find a conversation" }).click();
  await expect(page.locator(".chat")).toBeVisible();
}

test("ASL progress is per person and picture invitation waits for ten each", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot({ count: 4 });
  room.aslProgress[1].count = 5;
  await page.route("**/api/match", (route) =>
    route.fulfill({ json: { roomId: room.id } }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await openQuickChat(page);
  const sharing = page.getByLabel("Quick chat sharing", { exact: true });
  await expect(sharing).toContainText("You 4/5 · Stranger 5/5");
  await expect(sharing).not.toContainText("Picture sharing is now available.");
  await expect(
    page.getByRole("button", { name: "Show my profile picture" }),
  ).toHaveCount(0);
  room.aslProgress[0].count = 5;
  room.asl_revealed = true;
  room.participants[1].asl = { age: 31, gender: "Woman", region: "Manila" };
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("A new hello for you");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(sharing).toContainText("ASL milestone reached.");
  await expect(sharing).toContainText("Age 31 · Woman · Manila");
  await expect(
    page.getByRole("button", { name: "Show my profile picture" }),
  ).toHaveCount(0);
});

test("declining persists across reopening and sharing later needs explicit approval", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot();
  const decisions: string[] = [];
  await page.route("**/api/match", (route) =>
    route.fulfill({ json: { roomId: room.id } }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await page.route(`**${roomUrl}/picture-sharing`, (route) => {
    const body = route.request().postDataJSON();
    const decision = body.decision;
    if (decision === "approved")
      expect(body.pictureId).toBe(room.pictureSharing.self.pictureId);
    decisions.push(decision);
    room.pictureSharing.self.decision = decision;
    return route.fulfill({ json: room });
  });
  await openQuickChat(page);
  await expect(
    page.getByText("Picture sharing is now available.", { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: ".context/fr12-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Show my profile picture", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: ".context/fr12-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(
    page.getByText("You can show your profile picture whenever you want.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Not now", exact: true }),
  ).toHaveCount(0);
  await openQuickChat(page);
  await expect(
    page.getByRole("button", { name: "Not now", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show my profile picture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await expect(
    page.getByText("You chose to show your profile picture in this chat.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(decisions).toEqual(["declined", "approved"]);
});

test("missing pictures show unavailable state and approved peer picture is announced", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot({ hasPicture: false });
  room.pictureSharing.participants.push({
    id: visualIds.peer,
    url: `${roomUrl}/pictures/${visualIds.peer}`,
  });
  await page.route("**/api/match", (route) =>
    route.fulfill({ json: { roomId: room.id } }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await openQuickChat(page);
  await expect(
    page.getByText(
      "You don’t have a profile picture to share. Your picture stays hidden.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show my profile picture" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Stranger chose to show you their profile picture.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByAltText("Stranger’s shared profile picture"),
  ).toHaveAttribute("src", `${roomUrl}/pictures/${visualIds.peer}`);
});

test("a changed picture refreshes the consent choice before retry", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot();
  let attempts = 0;
  await page.route("**/api/match", (route) =>
    route.fulfill({ json: { roomId: room.id } }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await page.route(`**${roomUrl}/picture-sharing`, (route) => {
    if (++attempts === 1) {
      room.pictureSharing.self.pictureId =
        "60000000-0000-4000-8000-000000000002";
      room.pictureSharing.self.previewUrl = `/api/profile/picture/content?pictureId=${room.pictureSharing.self.pictureId}`;
      return route.fulfill({
        status: 409,
        json: { error: "Your picture changed. Please choose again." },
      });
    }
    expect(route.request().postDataJSON().pictureId).toBe(
      room.pictureSharing.self.pictureId,
    );
    room.pictureSharing.self.decision = "approved";
    return route.fulfill({ json: room });
  });
  await openQuickChat(page);
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await expect(
    page.getByText("Your picture changed. Please choose again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByAltText("The profile picture you can choose to share"),
  ).toHaveAttribute("src", room.pictureSharing.self.previewUrl);
  await expect(
    page.getByRole("button", { name: "Show my profile picture", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await expect(
    page.getByText("You chose to show your profile picture in this chat.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("a delayed sharing response cannot reopen a chat after Next", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot();
  let matches = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/match", (route) =>
    route.fulfill({
      json: ++matches === 1 ? { roomId: room.id } : { queued: true },
    }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await page.route(`**${roomUrl}/picture-sharing`, async (route) => {
    entered();
    await held;
    room.pictureSharing.self.decision = "approved";
    await route.fulfill({ json: room });
  });
  await openQuickChat(page);
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await requested;
  await page.locator(".room-leave-button").click();
  await expect(
    page.getByRole("heading", { name: "Finding a conversation…", exact: true }),
  ).toBeVisible();
  release();
  await expect(page.locator(".chat")).toHaveCount(0);
});

test("an old approval response cannot transfer consent into a new eligible match", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const room = snapshot();
  const nextRoom = { ...snapshot(), id: visualIds.contact };
  let matches = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/match", (route) =>
    route.fulfill({
      json: { roomId: ++matches === 1 ? room.id : nextRoom.id },
    }),
  );
  await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
  await page.route(`**/api/rooms/${nextRoom.id}`, (route) =>
    route.fulfill({ json: nextRoom }),
  );
  await page.route(`**${roomUrl}/picture-sharing`, async (route) => {
    entered();
    await held;
    room.pictureSharing.self.decision = "approved";
    await route.fulfill({ json: room });
  });
  const newDecisions: string[] = [];
  await page.route(`**/api/rooms/${nextRoom.id}/picture-sharing`, (route) => {
    newDecisions.push(route.request().postDataJSON().decision);
    nextRoom.pictureSharing.self.decision = "approved";
    return route.fulfill({ json: nextRoom });
  });
  await openQuickChat(page);
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await requested;
  const newRoomRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/rooms/${nextRoom.id}`,
  );
  await page.locator(".room-leave-button").click();
  await newRoomRead;
  await expect(
    page.getByRole("button", { name: "Not now", exact: true }),
  ).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${roomUrl}/picture-sharing`,
  );
  release();
  await (await oldResponse).finished();
  await page
    .getByRole("button", { name: "Show my profile picture", exact: true })
    .click();
  await expect(
    page.getByText("You chose to show your profile picture in this chat.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(newDecisions).toEqual(["approved"]);
});

test("profile picture upload waits for approval and restores the private preview", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const pictureId = "60000000-0000-4000-8000-000000000001";
  let saved = false;
  const operations: string[] = [];
  await page.route("**/api/profile/picture", (route) =>
    route.fulfill({
      json: {
        picture: saved
          ? { id: pictureId, url: "/api/profile/picture/content" }
          : null,
        uploadAvailable: true,
      },
    }),
  );
  await page.route("**/api/profile/picture/init", (route) => {
    operations.push("init");
    expect(route.request().postDataJSON()).toEqual({
      mime: "image/png",
      size: 4,
    });
    return route.fulfill({
      json: { id: pictureId, url: `/api/profile/picture/${pictureId}/upload` },
    });
  });
  await page.route(`**/api/profile/picture/${pictureId}/upload`, (route) => {
    operations.push("upload");
    expect(route.request().headers()["x-csrf-token"]).toBe("visual-csrf");
    expect(route.request().headers()["content-type"]).toBe("image/png");
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/profile/picture/${pictureId}/complete`, (route) => {
    operations.push("approve");
    saved = true;
    return route.fulfill({ json: { id: pictureId, state: "APPROVED" } });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Your profile", exact: true })
    .click();
  await page.getByLabel("Add profile picture").setInputFiles({
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from([1, 2, 3, 4]),
  });
  await expect(
    page.getByText(
      "Profile picture saved. You choose whether to share it in each quick chat.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByAltText("Your private profile picture"),
  ).toHaveAttribute("src", `/api/profile/picture/content?v=${pictureId}`);
  expect(operations).toEqual(["init", "upload", "approve"]);
});

test("a rejected picture upload keeps the existing picture and allows retry", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const pictureId = "60000000-0000-4000-8000-000000000001";
  await page.route("**/api/profile/picture", (route) =>
    route.fulfill({
      json: {
        picture: { id: pictureId, url: "/api/profile/picture/content" },
        uploadAvailable: true,
      },
    }),
  );
  await page.route("**/api/profile/picture/init", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Picture upload is temporarily unavailable" },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Your profile", exact: true })
    .click();
  await page.getByLabel("Replace profile picture").setInputFiles({
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from([1, 2, 3, 4]),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Picture upload is temporarily unavailable",
  );
  await expect(page.getByAltText("Your private profile picture")).toBeVisible();
  await expect(page.getByLabel("Replace profile picture")).toBeEnabled();
});
