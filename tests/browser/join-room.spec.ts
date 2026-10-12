import { expect, test, type Page } from "@playwright/test";
import { visualFixture, visualIds } from "./visual-fixture";

test("a visitor can unblock the host from their profile and retry the invitation", async ({
  page,
  context,
  baseURL,
}) => {
  await visualFixture(context);
  await profileResponse(page);
  let blocked = true;
  let deletedId: string | undefined;
  await page.route("**/api/blocks", (route) =>
    route.fulfill({
      json: blocked ? [{ id: visualIds.peer, display_name: "Milo Hart" }] : [],
    }),
  );
  await page.route("**/api/blocks/*", (route) => {
    deletedId = new URL(route.request().url()).pathname.split("/").at(-1);
    blocked = false;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/shared/join", (route) =>
    route.fulfill(
      blocked
        ? {
            status: 403,
            json: {
              error:
                "You blocked this room’s host. Unblock them in Your profile → Blocked members to join.",
            },
          }
        : {
            json: {
              pending: true,
              roomId: visualIds.group,
              requestId: "recovery-request",
              title: "Coffee with friends",
            },
          },
    ),
  );
  await openJoin(page);
  await page
    .getByLabel("Room invitation URL", { exact: true })
    .fill(`${baseURL}/#room=${"d".repeat(43)}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Unblock them in Your profile",
  );
  await page.getByRole("button", { name: "Your profile", exact: true }).click();
  await page.getByRole("button", { name: "Unblock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unblock", exact: true }),
  ).toHaveCount(0);
  expect(deletedId).toBe(visualIds.peer);
  await page.getByRole("button", { name: "Your rooms", exact: true }).click();
  await page
    .getByRole("button", { name: "Join this room", exact: true })
    .click();
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.locator(".pending-banner")).toContainText(
    "Request to join “Coffee with friends” is pending",
  );
});

async function openJoin(page: Page) {
  await page.goto("/");
  await page
    .locator(".hero-actions")
    .getByRole("button", { name: "Join a room", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Join a room", exact: true }),
  ).toBeVisible();
}
async function profileResponse(page: Page) {
  await page.route("**/api/me/profile", (route) => {
    const profile = route.request().postDataJSON();
    return route.fulfill({
      json: {
        id: visualIds.user,
        displayName: profile.displayName,
        verified: true,
        role: "USER",
        status: "Online",
        profile,
      },
    });
  });
}
test("joining requires a complete, valid invitation URL", async ({
  page,
  context,
}) => {
  await visualFixture(context, false);
  let joins = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/shared/join") joins++;
  });
  await openJoin(page);
  const dialog = page.getByRole("dialog", { name: "Join a room", exact: true });
  for (const input of [
    "",
    "not a URL",
    "a".repeat(43),
    `javascript:alert(1)#room=${"a".repeat(43)}`,
    "https://charoo.live/",
    "https://charoo.live/#room=invalid",
    `https://charoo.live/#room=${"a".repeat(43)}&room=${"b".repeat(43)}`,
  ]) {
    await page.getByLabel("Room invitation URL", { exact: true }).fill(input);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      page.getByLabel("Room invitation URL", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(new URL(page.url()).hash).toBe("");
  }
  expect(joins).toBe(0);
});

test("signed-in users paste a URL and confirm their nickname before joining", async ({
  page,
  context,
  baseURL,
}) => {
  await visualFixture(context);
  await profileResponse(page);
  const token = "a".repeat(43);
  let joinedToken: string | undefined;
  await page.route("**/api/shared/join", (route) => {
    joinedToken = route.request().postDataJSON().token;
    return route.fulfill({ json: { id: visualIds.group } });
  });
  await openJoin(page);
  await page
    .getByLabel("Room invitation URL", { exact: true })
    .fill(` https://charoo.live/?source=invite#room=${token} `);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Join this room", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  expect(new URL(page.url()).hash).toBe(`#room=${token}`);
  expect(joinedToken).toBeUndefined();
  await page.getByLabel("Nickname", { exact: true }).fill("My room nickname");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();
  expect(joinedToken).toBe(token);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
});

test("mobile guests can join from a pasted invitation URL", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visualFixture(context, false);
  const token = "b".repeat(43);
  let joinedToken: string | undefined;
  await page.route("**/api/auth/guest", (route) => {
    const profile = route.request().postDataJSON().profile;
    return route.fulfill({
      json: {
        csrf: "guest-csrf",
        user: {
          id: visualIds.peer,
          displayName: profile.displayName,
          verified: false,
          role: "USER",
          status: "Online",
          profile,
        },
      },
    });
  });
  await page.route("**/api/shared/join", (route) => {
    joinedToken = route.request().postDataJSON().token;
    return route.fulfill({ json: { id: visualIds.group } });
  });
  await openJoin(page);
  await page
    .getByLabel("Room invitation URL", { exact: true })
    .fill(`${baseURL}/#room=${token}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Join this room", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Nickname", { exact: true }).fill("Mobile friend");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue as guest", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();
  expect(joinedToken).toBe(token);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("pasted invitations preserve host approval requirements", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  await profileResponse(page);
  const token = "c".repeat(43);
  await page.route("**/api/shared/join", (route) =>
    route.fulfill({
      json: {
        pending: true,
        roomId: visualIds.group,
        requestId: "pending-request",
        title: "Coffee with friends",
      },
    }),
  );
  await page.route("**/api/rooms/*/join-status", (route) =>
    route.fulfill({ json: { status: "PENDING" } }),
  );
  await openJoin(page);
  await page
    .getByLabel("Room invitation URL", { exact: true })
    .fill(`https://charoo.live/#room=${token}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.locator(".pending-banner")).toContainText(
    "Request to join “Coffee with friends” is pending",
  );
  await expect(page.locator(".chat")).toHaveCount(0);
});
