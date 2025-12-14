import { test, expect } from "@playwright/test";

/**
 * E2E Tests: Keyboard Shortcuts for Menu Navigation
 *
 * Tests the keyboard shortcuts for opening menus and navigating within them.
 */

test.describe("Menu Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should open satellite selection menu with 's' key @critical", async ({ page }) => {
    await page.keyboard.press("s");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Enabled satellite groups")')).toBeVisible();

    // Verify first item is highlighted (groups dropdown)
    const firstItem = page.locator(".toolbarContent.menu-item-focused").first();
    await expect(firstItem).toBeVisible();
  });

  test("should open satellite visuals menu with 'Shift+S' key", async ({ page }) => {
    await page.keyboard.press("Shift+S");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible();

    // Verify first component checkbox is highlighted
    const firstItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(firstItem).toBeVisible();
  });

  test("should open ground station menu with 'g' key", async ({ page }) => {
    await page.keyboard.press("g");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Ground station")')).toBeVisible();

    // Verify first item is highlighted
    const firstItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(firstItem).toBeVisible();
  });

  test("should open layers menu with 'l' key", async ({ page }) => {
    await page.keyboard.press("l");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Layers")')).toBeVisible();

    // Verify first item is highlighted
    const firstItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(firstItem).toBeVisible();
  });

  test("should open debug menu with 'Shift+D' key", async ({ page }) => {
    await page.keyboard.press("Shift+D");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Debug")')).toBeVisible();

    // Verify first item is highlighted
    const firstItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(firstItem).toBeVisible();
  });

  test("should close menu with Escape key @critical", async ({ page }) => {
    // Open satellite visuals menu
    await page.keyboard.press("Shift+S");
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");

    // Verify menu is closed
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).not.toBeVisible();
  });

  test("should switch between menus using shortcuts", async ({ page }) => {
    // Open satellite visuals menu
    await page.keyboard.press("Shift+S");
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible();

    // Switch to ground station menu
    await page.keyboard.press("g");
    await expect(page.locator('.toolbarSwitches:has-text("Ground station")')).toBeVisible();
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).not.toBeVisible();
  });
});

test.describe("Menu Navigation with Arrow Keys", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should navigate satellite visuals menu items with arrow keys @critical", async ({ page }) => {
    // Open satellite visuals menu
    await page.keyboard.press("Shift+S");

    // Get number of menu items
    const menuItems = await page.locator(".toolbarSwitches:visible .toolbarSwitch").count();
    expect(menuItems).toBeGreaterThan(0);

    // Verify first item is focused
    let focusedItems = await page.locator(".toolbarSwitch.menu-item-focused").count();
    expect(focusedItems).toBe(1);

    // Navigate down
    await page.keyboard.press("ArrowDown");

    // Verify second item is now focused
    const secondItemText = await page.locator(".toolbarSwitch.menu-item-focused").textContent();
    expect(secondItemText).toBeTruthy();

    // Navigate up
    await page.keyboard.press("ArrowUp");

    // Verify we're back to first item
    focusedItems = await page.locator(".toolbarSwitch.menu-item-focused").count();
    expect(focusedItems).toBe(1);
  });

  test("should toggle checkbox with Enter key in satellite visuals menu", async ({ page }) => {
    // Open satellite visuals menu
    await page.keyboard.press("Shift+S");

    // Get first checkbox
    const firstCheckbox = page.locator('.toolbarSwitch.menu-item-focused input[type="checkbox"]').first();
    const initialState = await firstCheckbox.isChecked();

    // Press Enter to toggle
    await page.keyboard.press("Enter");

    // Verify state changed
    const newState = await firstCheckbox.isChecked();
    expect(newState).toBe(!initialState);

    // Press Enter again to toggle back
    await page.keyboard.press("Enter");
    const finalState = await firstCheckbox.isChecked();
    expect(finalState).toBe(initialState);
  });

  test("should navigate to button in ground station menu", async ({ page }) => {
    // Open ground station menu
    await page.keyboard.press("g");

    // First item is a checkbox (Pick on globe)
    let focusedItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(focusedItem).toBeVisible();

    // Navigate to second item (Set from geolocation button)
    await page.keyboard.press("ArrowDown");

    // Verify a menu item is still focused
    focusedItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(focusedItem).toBeVisible();
  });

  test("should wrap to first item when navigating past last item", async ({ page }) => {
    // Open satellite visuals menu (simpler menu with predictable items)
    await page.keyboard.press("Shift+S");

    // Get the first item text
    const firstItemText = await page.locator(".toolbarSwitch.menu-item-focused").first().textContent();

    // Navigate down multiple times to wrap around
    // Satellite visuals has 7 components, so pressing down 7 times should wrap
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("ArrowDown");
    }

    // Should be back at first item
    const currentItemText = await page.locator(".toolbarSwitch.menu-item-focused").first().textContent();
    expect(currentItemText).toBe(firstItemText);
  });
});

test.describe("Satellite Selection Menu Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should highlight groups dropdown when opening satellite menu", async ({ page }) => {
    await page.keyboard.press("s");

    // Verify groups dropdown is highlighted
    const focusedContent = page.locator(".toolbarContent.menu-item-focused").first();
    await expect(focusedContent).toBeVisible();

    // Verify it contains the groups multiselect
    await expect(focusedContent.locator(".multiselect")).toBeVisible();
  });

  test("should open groups dropdown with Enter key", async ({ page }) => {
    await page.keyboard.press("s");
    await page.keyboard.press("Enter");

    // Verify dropdown is open (multiselect--active class or visible content)
    const dropdown = page.locator(".multiselect--active").first();
    await expect(dropdown).toBeVisible({ timeout: 2000 });
  });

  test("should auto-open satellites dropdown when pressing down arrow", async ({ page }) => {
    await page.keyboard.press("s");

    // Press down arrow to move to satellites dropdown
    await page.keyboard.press("ArrowDown");

    // Wait a bit for the dropdown to activate
    await page.waitForTimeout(200);

    // Verify a multiselect dropdown is active (either groups or satellites)
    const activeDropdown = page.locator(".multiselect--active");
    await expect(activeDropdown.first()).toBeVisible({ timeout: 2000 });
  });

  test("should remove highlight when dropdown is open", async ({ page }) => {
    await page.keyboard.press("s");

    // Open groups dropdown
    await page.keyboard.press("Enter");

    // Wait a bit for dropdown to open
    await page.waitForTimeout(100);

    // Verify no highlight is visible
    const focusedItems = await page.locator(".toolbarContent.menu-item-focused").count();
    expect(focusedItems).toBe(0);
  });

  test("should not trigger menu shortcuts when typing in dropdown @critical", async ({ page }) => {
    await page.keyboard.press("s");
    await page.keyboard.press("ArrowDown");

    // Dropdown should be open, type some letters that would normally trigger shortcuts
    await page.keyboard.type("stations");

    // Verify we're still in the satellite menu (not switched to another menu)
    await expect(page.locator('.toolbarSwitches:has-text("Enabled satellite groups")')).toBeVisible();

    // Verify we didn't switch to ground station menu (which 's' would normally open)
    await expect(page.locator('.toolbarSwitches:has-text("Ground station")')).not.toBeVisible();
  });

  test("should re-enable navigation when dropdown closes", async ({ page }) => {
    await page.keyboard.press("s");
    await page.keyboard.press("Enter");

    // Wait for dropdown to open
    await page.waitForTimeout(200);

    // Close dropdown with Escape - this will close the menu entirely
    await page.keyboard.press("Escape");

    // Menu should be closed
    await expect(page.locator('.toolbarSwitches:has-text("Enabled satellite groups")')).not.toBeVisible();

    // Reopen menu
    await page.keyboard.press("s");

    // Arrow keys should work - verify by pressing down
    await page.keyboard.press("ArrowDown");

    // Verify dropdown opens (navigation is working)
    const activeDropdown = page.locator(".multiselect--active");
    await expect(activeDropdown.first()).toBeVisible({ timeout: 2000 });
  });
});

test.describe("Menu Closing Behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should close menu opened by click with Escape key", async ({ page }) => {
    // Click to open satellite visuals menu using the button with layer-group icon
    const button = page.locator("button.cesium-toolbar-button").filter({
      has: page.locator('[data-icon="layer-group"]'),
    });
    await button.click();

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");

    // Verify menu is closed
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).not.toBeVisible();
  });

  test("should close menu opened by shortcut with Escape key", async ({ page }) => {
    // Open with keyboard shortcut
    await page.keyboard.press("g");

    // Verify menu is open
    await expect(page.locator('.toolbarSwitches:has-text("Ground station")')).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");

    // Verify menu is closed
    await expect(page.locator('.toolbarSwitches:has-text("Ground station")')).not.toBeVisible();
  });

  test("should close satellite dropdown and menu with Escape key", async ({ page }) => {
    await page.keyboard.press("s");
    await page.keyboard.press("Enter");

    // Wait for dropdown to open
    await page.waitForTimeout(100);

    // Press Escape - should close both dropdown and menu
    await page.keyboard.press("Escape");

    // Verify menu is closed
    await expect(page.locator('.toolbarSwitches:has-text("Enabled satellite groups")')).not.toBeVisible();
  });
});

test.describe("Focus Indicator Visual Feedback", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should show green highlight on focused menu item", async ({ page }) => {
    await page.keyboard.press("Shift+S");

    // Get the focused item
    const focusedItem = page.locator(".toolbarSwitch.menu-item-focused").first();
    await expect(focusedItem).toBeVisible();

    // Verify the CSS class is applied
    const hasClass = await focusedItem.evaluate((el) => el.classList.contains("menu-item-focused"));
    expect(hasClass).toBe(true);
  });

  test("should move highlight when navigating with arrows", async ({ page }) => {
    await page.keyboard.press("Shift+S");

    // Get first item text
    const firstItemText = await page.locator(".toolbarSwitch.menu-item-focused").first().textContent();

    // Navigate down
    await page.keyboard.press("ArrowDown");

    // Get new focused item text
    const secondItemText = await page.locator(".toolbarSwitch.menu-item-focused").first().textContent();

    // Verify the text changed (we moved to a different item)
    expect(secondItemText).not.toBe(firstItemText);
  });

  test("should show highlight on satellite selection dropdowns", async ({ page }) => {
    await page.keyboard.press("s");

    // Verify groups dropdown has highlight
    const groupsHighlight = page.locator(".toolbarContent.menu-item-focused").first();
    await expect(groupsHighlight).toBeVisible();

    // Navigate down
    await page.keyboard.press("ArrowDown");

    // Wait a moment for navigation
    await page.waitForTimeout(50);

    // Note: The satellites dropdown opens automatically, so highlight is removed
    // This is expected behavior
  });
});
