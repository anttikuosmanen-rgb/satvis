import { test, expect } from "@playwright/test";
import { pauseAnimation, waitForAppReady } from "./helpers/globe-interaction";

/**
 * E2E Tests: Sky Map Selection and Transparency
 *
 * Tests the sky map layer system for selecting alternative sky maps
 * with per-layer transparency controls.
 */

test.describe("Sky Map Selection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await waitForAppReady(page);
    await pauseAnimation(page);
  });

  test("should have Tycho2K enabled by default with MultiLayerSkyBox", async ({ page }) => {
    // Tycho2K is enabled by default — wait for the watcher to create MultiLayerSkyBox
    await page.waitForFunction(() => window.cc?.viewer?.scene?.skyBox?.isMultiLayerSkyBox === true, { timeout: 15000 });
    const isMultiLayer = await page.evaluate(() => {
      return window.cc?.viewer?.scene?.skyBox?.isMultiLayerSkyBox === true;
    });
    expect(isMultiLayer).toBe(true);

    // Open Layers menu
    await page.keyboard.press("l");

    // Verify Tycho2K checkbox is already checked
    const tycho2KCheckbox = page.locator('.toolbarSwitch:has-text("Tycho2K") input[type=checkbox]');
    await expect(tycho2KCheckbox).toBeChecked();

    // Verify opacity slider appears for the default layer
    const opacitySlider = page.locator('.skymap-opacity:has-text("Tycho2K opacity") input[type=range]');
    await expect(opacitySlider).toBeVisible();
  });

  test("should adjust sky map opacity and reflect in URL", async ({ page }) => {
    // Open Layers menu
    await page.keyboard.press("l");

    // Set Tycho2K opacity to 0.5 (it's enabled by default)
    const opacitySlider = page.locator('.skymap-opacity:has-text("Tycho2K opacity") input[type=range]');
    await expect(opacitySlider).toBeVisible();
    await opacitySlider.fill("0.5");

    // Verify the URL contains sky map parameter with new opacity
    await expect(page).toHaveURL(/sky=Tycho2K_0\.5/);

    // Verify canvas is still rendering
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
  });

  test("should persist sky map selection via URL", async ({ page }) => {
    // Navigate with sky map URL parameter
    await page.goto("/?sky=Tycho2K_0.7");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await waitForAppReady(page);

    // Verify the skyBox is a MultiLayerSkyBox (wait for watcher to process URL state)
    await page.waitForFunction(() => window.cc?.viewer?.scene?.skyBox?.isMultiLayerSkyBox === true, { timeout: 15000 });

    // Open Layers menu and verify checkbox is checked
    await page.keyboard.press("l");

    const tycho2KCheckbox = page.locator('.toolbarSwitch:has-text("Tycho2K") input[type=checkbox]');
    await expect(tycho2KCheckbox).toBeChecked();

    // Verify opacity slider shows 0.7
    const opacitySlider = page.locator('.skymap-opacity:has-text("Tycho2K opacity") input[type=range]');
    await expect(opacitySlider).toHaveValue("0.7");
  });

  test("should restore default Cesium skybox when all sky maps disabled", async ({ page }) => {
    // Open Layers menu
    await page.keyboard.press("l");

    // Disable Tycho2K (enabled by default)
    const tycho2KLabel = page.locator('.toolbarSwitch:has-text("Tycho2K")');
    await tycho2KLabel.click();

    // Verify skyBox is no longer a MultiLayerSkyBox
    const isMultiLayer = await page.evaluate(() => {
      return window.cc?.viewer?.scene?.skyBox?.isMultiLayerSkyBox === true;
    });
    expect(isMultiLayer).toBe(false);
  });
});
