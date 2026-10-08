import { expect, test } from "@playwright/test";

const route = "/brief/engineering-scan-k4m8/";

test("saves project context and navigates the full workbench", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(route);
  await expect(page.getByRole("heading", { name: "Start with traceable context." })).toBeVisible();
  await page.getByLabel("Project ID").fill("WEB-TEST-001");
  await page.getByRole("button", { name: "Save project", exact: true }).last().click();
  await expect(page.locator("#headerProjectId")).toHaveText("WEB-TEST-001");

  await page.getByRole("button", { name: /Model/ }).click();
  await expect(page.locator("#boundX")).toHaveText("100.00 mm");
  await expect(page.locator("#modelCanvas")).toBeVisible();

  await page.getByRole("button", { name: /Surface analysis/ }).click();
  await page.getByRole("button", { name: "Sample surface" }).first().click();
  await expect(page.locator("#heightValid")).not.toHaveText("—");
  await expect(page.locator("#heightRange")).toContainText("mm");
  expect(errors).toEqual([]);
});

test("mobile workflow and inspector remain operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route);
  await page.getByRole("button", { name: "Open workflow" }).click();
  await expect(page.locator("#workflowNav")).toBeVisible();
  await page.getByRole("button", { name: /Measurements/ }).click();
  await expect(page.locator("#measurementCanvas")).toBeVisible();
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(page.locator("#inspector")).toBeVisible();
  await expect(page.locator("#boundZ")).toContainText("mm");
});
