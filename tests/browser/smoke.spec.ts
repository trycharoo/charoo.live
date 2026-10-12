import { test, expect } from "@playwright/test";
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
  await page
    .getByRole("button", { name: "Join this room", exact: true })
    .click();
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
test("desktop guest creates an unlisted room, sends a message, and reloads the session", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "One link. Everyone’s in." }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("18+");
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
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
    await guestPage
      .getByRole("button", { name: "Join this room", exact: true })
      .click();
    await guestPage.getByRole("checkbox").check();
    await guestPage.getByRole("button", { name: "Continue as guest" }).click();
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
    await expect(
      guestPage.getByRole("button", {
        name: "Invite people to room",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
  await page.reload();
  await expect(page.getByText("Guest · temporary identity")).toBeVisible();
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
    page.getByRole("heading", { name: "One link. Everyone’s in." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page.getByRole("button", { name: "Quick chat", exact: true }).click();
  await page.getByRole("button", { name: "Meet someone", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page.getByRole("button", { name: "Your rooms", exact: true }).click();
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
    .getByRole("button", { name: "Room details and host controls" })
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
  await page.getByRole("button", { name: "Edit room & message pace" }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Updated mobile room");
  await page.getByLabel("Seconds between messages").fill("0");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated mobile room", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One link. Everyone’s in." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
