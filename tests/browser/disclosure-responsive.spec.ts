import { expect, test, type Page } from "@playwright/test";
import { visualFixture, visualIds } from "./visual-fixture";

const sizes = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];
const pictureId = "60000000-0000-4000-8000-000000000001";
const roomUrl = `/api/rooms/${visualIds.group}`;

async function navigate(page: Page, name: string) {
  await expect(page.locator(".connection")).toHaveText("Online");
  const menu = page.getByRole("button", { name: "Toggle menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  const button = page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name, exact: true });
  await expect(button).toBeAttached();
  await button.click();
}
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}
async function pictures(page: Page) {
  await page.route("**/api/profile/picture/content*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="360"><rect width="120" height="360" fill="#ddd1eb"/><circle cx="60" cy="60" r="30" fill="#765d8d"/></svg>',
    }),
  );
  await page.route("**/api/rooms/*/pictures/*/content*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="#d2eadc"/><circle cx="320" cy="80" r="60" fill="#567b66"/></svg>',
    }),
  );
}

for (const viewport of sizes) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`picture consent and chat remain usable at ${size}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    await visualFixture(context);
    await pictures(page);
    const room = {
      id: visualIds.group,
      type: "STRANGER",
      state: "OPEN",
      online: 2,
      title: "Quick chat",
      asl_revealed: true,
      participants: [
        { id: visualIds.user, name: "Stranger", asl: null },
        {
          id: visualIds.peer,
          name: "Stranger",
          asl: { age: 31, gender: "Woman", region: "Metro Manila" },
        },
      ],
      aslProgress: [
        { id: visualIds.user, count: 10 },
        { id: visualIds.peer, count: 10 },
      ],
      pictureSharing: {
        eligible: true,
        self: {
          hasPicture: true,
          decision: "pending",
          pictureId,
          previewUrl: `/api/profile/picture/content?pictureId=${pictureId}`,
        },
        participants: [
          {
            id: visualIds.peer,
            url: `${roomUrl}/pictures/${visualIds.peer}/content?pictureId=${pictureId}`,
          },
        ],
      },
    };
    await page.route("**/api/match", (route) =>
      route.fulfill({ json: { roomId: room.id } }),
    );
    await page.route(`**${roomUrl}`, (route) => route.fulfill({ json: room }));
    await page.route(`**${roomUrl}/picture-sharing`, (route) => {
      const input = route.request().postDataJSON();
      if (input.decision === "approved")
        expect(input.pictureId).toBe(pictureId);
      room.pictureSharing.self.decision = input.decision;
      return route.fulfill({ json: room });
    });
    await page.goto("/");
    await navigate(page, "Quick chat");
    await page.getByRole("button", { name: "Find a conversation" }).click();
    const card = page.getByLabel("Quick chat sharing", { exact: true });
    await expect(card).toContainText("Picture sharing is now available.");
    await noOverflow(page);
    expect(await card.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    const approve = page.getByRole("button", {
      name: "Show my profile picture",
      exact: true,
    });
    const decline = page.getByRole("button", { name: "Not now", exact: true });
    for (const control of [approve, decline]) {
      const bounds = await control.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    await expect(
      page.getByAltText("The profile picture you can choose to share"),
    ).toHaveCSS("object-fit", "contain");
    const shared = page.getByAltText("Stranger’s shared profile picture");
    await expect(shared).toHaveJSProperty("naturalWidth", 640);
    const dimensions = await shared.boundingBox();
    expect(dimensions!.width / dimensions!.height).toBeCloseTo(4, 0);
    await expect
      .poll(async () => {
        const composer = await page.locator(".composer").boundingBox();
        return composer!.y + composer!.height;
      })
      .toBeLessThanOrEqual(viewport.height + 1);
    expect(
      await page.locator(".messages").evaluate((e) => e.clientHeight),
    ).toBeGreaterThan(32);
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport();
    if ([390, 1440].includes(viewport.width))
      await page.screenshot({
        path: `.context/fr12-responsive-${size}.png`,
        animations: "disabled",
      });
    await decline.click();
    await expect(card).toContainText(
      "You can show your profile picture whenever you want.",
    );
    await approve.click();
    await expect(card).toContainText(
      "You chose to show your profile picture in this chat.",
    );
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("A message after sharing");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeInViewport();
    await noOverflow(page);
  });

  test(`profile picture upload and long errors fit at ${size}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    await visualFixture(context);
    await pictures(page);
    await page.route("**/api/profile/picture", (route) =>
      route.fulfill({
        json: {
          picture: { id: pictureId, url: "/api/profile/picture/content" },
          uploadAvailable: true,
        },
      }),
    );
    const error = `Picture unavailable. ${"A".repeat(180)}`;
    await page.route("**/api/profile/picture/init", (route) =>
      route.fulfill({ status: 503, json: { error } }),
    );
    await page.goto("/");
    await navigate(page, "Your profile");
    const panel = page.getByLabel("Your profile picture", { exact: true });
    await expect(panel).toBeVisible();
    await noOverflow(page);
    const preview = page.getByAltText("Your private profile picture");
    await expect(preview).toHaveJSProperty("naturalHeight", 360);
    const bounds = await preview.boundingBox();
    expect(bounds!.height / bounds!.width).toBeCloseTo(3, 0);
    const picker = page.getByLabel("Replace profile picture");
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await picker.setInputFiles({
      name: `${"long-picture-name".repeat(8)}.png`,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3, 4]),
    });
    await expect(panel.getByRole("alert")).toHaveText(error);
    expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await panel.getByRole("alert").scrollIntoViewIfNeeded();
    await expect(picker).toBeEnabled();
    await noOverflow(page);
  });
}
