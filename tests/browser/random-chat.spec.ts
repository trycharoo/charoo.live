import { expect, test } from "@playwright/test";
import { visualFixture, visualIds } from "./visual-fixture";

test("Next leaves the current random chat and queues a new match", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  const operations: string[] = [];
  let matches = 0;
  await page.route("**/api/match", (route) => {
    operations.push("match");
    return route.fulfill({
      json: ++matches === 1 ? { roomId: visualIds.group } : { queued: true },
    });
  });
  await page.route(`**/api/rooms/${visualIds.group}/leave`, (route) => {
    operations.push("leave");
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/rooms/${visualIds.group}`, (route) =>
    route.fulfill({
      json: {
        id: visualIds.group,
        type: "STRANGER",
        title: "Random conversation",
        description: "",
        state: "OPEN",
        creator_id: null,
        online: 2,
        slow_mode: 1,
        asl_revealed: false,
        participants: [
          { id: visualIds.user, name: "Cora Lane", verified: true },
          { id: visualIds.peer, name: "Milo Hart", verified: true },
        ],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Quick chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Find a conversation" }).click();
  await expect(page.locator(".chat")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Block Milo Hart", exact: true }),
  ).toHaveCount(0);
  await page.locator(".room-leave-button").click();
  await expect(
    page.getByRole("heading", { name: "Finding a conversation…", exact: true }),
  ).toBeVisible();
  expect(operations).toEqual(["match", "leave", "match"]);
  await expect(page.locator(".chat")).toHaveCount(0);
});
