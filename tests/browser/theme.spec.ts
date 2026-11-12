import { expect, test } from "@playwright/test";
import { visualFixture } from "./visual-fixture";

test("palette changes reach the whole app and survive reloads", async ({
  page,
  context,
}) => {
  await visualFixture(context);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await page.getByRole("button", { name: "Ocean palette" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const background = await page
    .locator("html")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const sidebar = await page
    .locator(".sidebar")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe("rgb(241, 247, 253)");
  expect(sidebar).not.toBe("rgb(25, 23, 32)");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Coffee with friends", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composer-row > input")).toBeVisible();
  const panel = await page
    .locator(".composer")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panel).toBe(sidebar);
});

test("custom colors apply immediately, persist, and can be reset", async ({
  page,
  context,
}) => {
  await visualFixture(context, false);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await page.getByLabel("Accent color", { exact: true }).fill("#ff8b5c");
  await page.getByLabel("Background color", { exact: true }).fill("#142424");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "custom");
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--accent")),
  ).toBe("#ff8b5c");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await expect(page.getByLabel("Accent color", { exact: true })).toHaveValue(
    "#ff8b5c",
  );
  await expect(
    page.getByLabel("Background color", { exact: true }),
  ).toHaveValue("#142424");
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "pop");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Make it yours" })).toHaveCount(
    0,
  );
});

test("mobile appearance controls follow the device without overflowing", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await visualFixture(context);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await page.getByRole("button", { name: "Device", exact: true }).click();
  await page.getByRole("button", { name: "Mint palette" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Make it yours" });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Toggle menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Coffee with friends", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coffee with friends", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Make it yours" }),
  ).toBeVisible();
});

test("appearance controls work when storage is unavailable", async ({
  page,
  context,
}) => {
  await visualFixture(context, false);
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Customize theme", exact: true })
    .click();
  await page.getByRole("button", { name: "Rose palette" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "rose");
  await expect(
    page.getByText("This browser couldn’t save them", { exact: false }),
  ).toBeVisible();
});
