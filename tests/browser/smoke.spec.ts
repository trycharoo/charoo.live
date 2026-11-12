import { test, expect } from "@playwright/test";
import { defaultSettings, type Profile, type User } from "@charoo/contracts";
import { visualFixture, visualIds } from "./visual-fixture";
test("Google sign-in preserves the room invitation when the user cancels", async ({
  page,
  baseURL,
}) => {
  const roomToken = "a".repeat(43);
  let started: Record<string, unknown> | undefined;
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { google: true } }),
  );
  await page.route("**/api/auth/google", (route) => {
    started = route.request().postDataJSON();
    return route.fulfill({
      json: {
        url: `${baseURL}/?google_callback=1#room=${roomToken}&authError=cancelled`,
      },
    });
  });
  await page.goto(`/#room=${roomToken}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Google sign-in was cancelled",
  );
  expect(started).toEqual({
    communityConsent: true,
    roomToken,
    createRoom: false,
  });
  expect(new URL(page.url()).hash).toBe(`#room=${roomToken}`);
  await expect(
    page.getByRole("button", { name: "Join this room", exact: true }),
  ).toBeVisible();
});
test("Google sign-in confirms the profile before entering the invited room", async ({
  page,
  context,
  baseURL,
}) => {
  await visualFixture(context);
  const roomToken = "b".repeat(43);
  let signedIn = false;
  let savedProfile: Profile | undefined;
  let joinedToken: string | undefined;
  let account: User = {
    id: visualIds.user,
    displayName: "Google name",
    verified: true,
    role: "USER",
    status: "Online",
    profile: {
      displayName: "Google name",
      age: null,
      gender: "",
      region: "Manila",
      bio: "Keep this bio",
      interests: ["Coffee"],
      aslVisibility: "private",
    },
  };
  await page.route("**/api/me", (route) =>
    route.fulfill(
      signedIn
        ? {
            json: {
              user: account,
              csrf: "fixture-csrf",
              settings: defaultSettings,
            },
          }
        : { status: 401, json: { error: "Sign in to continue" } },
    ),
  );
  await page.route("**/api/auth/google", (route) => {
    expect(route.request().postDataJSON().roomToken).toBe(roomToken);
    signedIn = true;
    return route.fulfill({
      json: {
        url: `${baseURL}/?google_callback=1#room=${roomToken}&auth=google`,
      },
    });
  });
  await page.route("**/api/me/profile", (route) => {
    savedProfile = route.request().postDataJSON();
    account = {
      ...account,
      displayName: savedProfile!.displayName,
      profile: savedProfile!,
    };
    return route.fulfill({ json: account });
  });
  await page.route("**/api/shared/join", (route) => {
    joinedToken = route.request().postDataJSON().token;
    return route.fulfill({ json: { id: visualIds.group } });
  });
  await page.goto(`/#room=${roomToken}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(
    "Google name",
  );
  expect(joinedToken).toBeUndefined();
  // Reloading before profile confirmation must keep the invitation and the join step.
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(joinedToken).toBeUndefined();
  await page.getByLabel("Nickname", { exact: true }).fill("Room nickname");
  await page.getByLabel("Age (optional)", { exact: true }).fill("31");
  await page
    .getByLabel("Sex (optional)", { exact: true })
    .selectOption("Other");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(joinedToken).toBe(roomToken);
  expect(savedProfile).toEqual({
    ...account.profile,
    displayName: "Room nickname",
    age: 31,
    gender: "Other",
    region: "Manila",
    bio: "Keep this bio",
    interests: ["Coffee"],
    aslVisibility: "private",
  });
  await expect.poll(() => new URL(page.url()).hash).toBe("");
});
test("Back keeps the main navigation when a room refresh finishes late", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  await page.goto("/");
  const roomResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/rooms/${visualIds.group}`,
  );
  await page
    .getByRole("button", { name: "Coffee with friends", exact: true })
    .click();
  const room = await (await roomResponse).json();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();

  let startRefresh!: () => void;
  let releaseRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    startRefresh = resolve;
  });
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route(`**/api/rooms/${visualIds.group}`, async (route) => {
    startRefresh();
    await refreshReleased;
    await route.fulfill({ json: room });
  });
  try {
    await page
      .getByRole("button", { name: "Mute Milo Hart", exact: true })
      .click();
    await refreshStarted;
    await page
      .getByRole("button", { name: "Back to rooms", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Main navigation", exact: true }),
    ).toBeVisible();
    releaseRefresh();
    await expect(
      page.getByText(
        "Member muted for 30 minutes. Click Unmute to let them chat again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main navigation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Room members", exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseRefresh();
  }
});
test("desktop guest creates an unlisted room, sends a message, and reloads the session", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your chats." }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("18+");
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
  await page.getByLabel("Nickname", { exact: true }).fill("Coffee host");
  await page.getByLabel("Age (optional)", { exact: true }).fill("29");
  await page
    .getByLabel("Sex (optional)", { exact: true })
    .selectOption("Other");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByText("Guest · temporary identity")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Create your room" }),
  ).toBeVisible();
  await page.getByLabel("Room title").fill("Browser test coffee room");
  await page.getByRole("button", { name: "Create & get a link" }).click();
  await expect(
    page.getByRole("heading", { name: "Your room is ready" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Secure room link" }),
  ).toHaveValue(/#room=/);
  const inviteUrl = await page
    .getByRole("textbox", { name: "Secure room link" })
    .inputValue();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Room invite link", exact: true }),
  ).toHaveValue(inviteUrl);
  await page
    .getByRole("button", { name: "Invite people to room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Invite people to your room",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Secure room link", exact: true }),
  ).toHaveValue(inviteUrl);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from a real browser");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page
      .locator(".messages")
      .getByText("Hello from a real browser", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not confirmed · retry")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Host controls" }),
  ).toBeVisible();

  const guestContext = await browser.newContext();
  try {
    const guestPage = await guestContext.newPage();
    await guestPage.goto(inviteUrl);
    await expect(guestPage.getByRole("dialog")).toBeVisible();
    await guestPage
      .getByLabel("Nickname", { exact: true })
      .fill("Coffee guest");
    await guestPage.getByRole("checkbox").check();
    await guestPage.getByRole("button", { name: "Continue as guest" }).click();
    await expect(
      guestPage.getByText(/Request to join.*is pending/),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Join requests/ }),
    ).toBeVisible();
    await expect(page.getByText("Coffee guest")).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(
      guestPage.getByRole("heading", {
        name: "Browser test coffee room",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      guestPage
        .locator(".messages")
        .getByText("Hello from a real browser", { exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByText("Host · moderator", { exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("heading", { name: "Host controls" }),
    ).toHaveCount(0);
    const guest = await (
      await guestPage.request.get(`${new URL(inviteUrl).origin}/api/me`)
    ).json();
    expect(guest.user).toMatchObject({
      displayName: "Coffee guest",
      profile: { age: null, gender: "", aslVisibility: "private" },
    });
    await expect.poll(() => new URL(guestPage.url()).hash).toBe("");
    await expect(
      guestPage.getByRole("button", {
        name: "Invite people to room",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Main navigation", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Room members", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".chat .participants")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Mute Coffee guest", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unmute Coffee guest", exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeDisabled();
    await expect(
      guestPage.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(
      guestPage.getByLabel("Attach a file", { exact: true }),
    ).toBeDisabled();
    await expect(
      guestPage.getByText("You’re muted by the host.", { exact: true }),
    ).toBeVisible();
    const guestRooms = await (
      await guestPage.request.get(
        `${new URL(inviteUrl).origin}/api/conversations`,
      )
    ).json();
    const joinedRoom = guestRooms.find(
      (r: any) => r.title === "Browser test coffee room",
    );
    const blockedWrite = await guestPage.request.post(
      `${new URL(inviteUrl).origin}/api/rooms/${joinedRoom.id}/messages`,
      {
        headers: {
          Origin: new URL(inviteUrl).origin,
          "X-CSRF-Token": guest.csrf,
        },
        data: {
          text: "Forged muted message",
          clientMessageId: crypto.randomUUID(),
        },
      },
    );
    expect(blockedWrite.status()).toBe(403);
    await guestPage.screenshot({
      path: ".context/muted-member-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Unmute Coffee guest", exact: true })
      .click();
    await expect(
      guestPage.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeEnabled();
    await guestPage
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("I can chat again");
    await guestPage
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".messages").getByText("I can chat again", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Block Coffee guest", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unblock Coffee guest", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unblock Coffee guest", exact: true }),
    ).toBeEnabled();
    await expect(
      page.locator(".messages").getByText("I can chat again", { exact: true }),
    ).toHaveCount(0);
    await expect(
      guestPage
        .locator(".messages")
        .getByText("Hello from a real browser", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: ".context/room-sidebar-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Unblock Coffee guest", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Block Coffee guest", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".messages").getByText("I can chat again", { exact: true }),
    ).toBeVisible();
    await expect(
      guestPage
        .locator(".messages")
        .getByText("Hello from a real browser", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to rooms", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Main navigation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Room members", exact: true }),
    ).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
  await page.reload();
  await expect(page.getByText("Guest · temporary identity")).toBeVisible();
  const host = await (await page.request.get("/api/me")).json();
  expect(host.user).toMatchObject({
    displayName: "Coffee host",
    profile: { age: 29, gender: "Other", aslVisibility: "private" },
  });
  await page
    .getByRole("button", { name: "Browser test coffee room", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Room invite link", exact: true }),
  ).toHaveValue(inviteUrl);
  await page
    .getByRole("button", { name: "Invite people to room", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Secure room link", exact: true }),
  ).toHaveValue(inviteUrl);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page
      .locator(".messages")
      .getByText("Hello from a real browser", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile navigation, dialog and layout fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your chats." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page.getByRole("button", { name: "Quick chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Find a conversation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Nickname", { exact: true }).fill("Mobile host");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chats", exact: true })
    .click();
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
  await page.getByLabel("Room title").fill("Mobile host room");
  await page.getByRole("button", { name: "Create & get a link" }).click();
  await expect(
    page.getByRole("heading", { name: "Your room is ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Invite people to room", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Secure room link", exact: true }),
  ).toHaveValue(/#room=/);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Show room members", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Host controls" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Room invite link", exact: true }),
  ).toHaveValue(/#room=/);
  await expect(
    page.getByRole("button", { name: "Close room", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".context/room-sidebar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Edit room & message pace" }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Updated mobile room");
  await page.getByLabel("Seconds between messages").fill("0");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated mobile room", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your chats." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
