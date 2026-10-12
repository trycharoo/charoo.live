import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { visualFixture } from "../../tests/browser/visual-fixture";
const reference = process.env.VISUAL_REFERENCE_URL;
if (!reference)
  throw new Error(
    "Set VISUAL_REFERENCE_URL to the original Charoo Vite server.",
  );
const migrated = process.env.VISUAL_TARGET_URL || "http://127.0.0.1:5173";
const directory = resolve(process.env.VISUAL_OUTPUT_DIR || ".context/visual");
mkdirSync(directory, { recursive: true });
function sameBytes(a: string, b: string) {
  const left = readFileSync(a),
    right = readFileSync(b);
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
const browser = await chromium.launch();
const report: any[] = [];
try {
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    for (const [label, baseURL] of [
      ["reference", reference],
      ["migrated", migrated],
    ] as const) {
      const context = await browser.newContext({
        viewport,
        baseURL,
        serviceWorkers: "block",
      });
      await visualFixture(context, false);
      const page = await context.newPage();
      const capture = async (screen: string) => {
        await page.evaluate(() => (globalThis as any).document.fonts.ready);
        await page.waitForTimeout(150);
        await page.screenshot({
          path: `${directory}/${label}-${device}-${screen}.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (label === "migrated")
          report.push({
            device,
            screen,
            identical: sameBytes(
              `${directory}/reference-${device}-${screen}.png`,
              `${directory}/migrated-${device}-${screen}.png`,
            ),
            width: viewport.width,
            overflow: await page.evaluate(
              () =>
                (globalThis as any).document.documentElement.scrollWidth >
                (globalThis as any).innerWidth,
            ),
          });
      };
      await page.goto("/");
      await page
        .getByRole("heading", { name: "One link. Everyone’s in." })
        .waitFor();
      await capture("landing");
      await page
        .getByRole("button", { name: "Start a room", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await capture("consent");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await context.unroute("**/api/**");
      await visualFixture(context, true);
      await page.reload();
      await page.locator(".user-mini").waitFor({ state: "attached" });
      await page
        .getByRole("button", {
          name: "Coffee with friends",
          exact: true,
          includeHidden: true,
        })
        .waitFor({ state: "attached" });
      await capture("groups");
      const navigate = async (name: string) => {
        if (device === "mobile")
          await page.getByRole("button", { name: "Toggle menu" }).click();
        await page
          .getByRole("button", { name: new RegExp("^" + name) })
          .click();
        await page.waitForTimeout(300);
      };
      for (const [name, screen] of [
        ["Discover rooms", "discovery"],
        ["Quick chat", "matching"],
        ["Your connections", "contacts"],
        ["Your profile", "profile"],
        ["Moderation", "admin"],
      ]) {
        await navigate(name);
        await capture(screen);
      }
      await navigate("Your rooms");
      if (device === "mobile")
        await page.getByRole("button", { name: "Toggle menu" }).click();
      await page
        .getByRole("button", { name: "Coffee with friends", exact: true })
        .click();
      await page
        .locator(".messages")
        .getByText("Count me in! Same place as last time?")
        .waitFor();
      await capture("chat");
      await page
        .getByRole("button", { name: "Invite people to room", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await capture("invite");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      if (device === "mobile") {
        await page
          .getByRole("button", { name: "Room details and host controls" })
          .click();
        await capture("host-controls");
        await page.getByRole("button", { name: "Close room details" }).click();
      }
      await navigate("Your rooms");
      await page
        .getByRole("button", { name: "Start a room", exact: true })
        .click();
      await page.getByRole("heading", { name: "Create your room" }).waitFor();
      await capture("create");
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(`${directory}/comparison.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    comparisons: report.length,
    identical: report.filter((r) => r.identical).length,
    overflow: report.filter((r) => r.overflow).length,
    directory,
  }),
);
if (report.some((r) => !r.identical || r.overflow)) process.exitCode = 1;
