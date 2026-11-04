import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = path.join(root, "test-results");
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(results, "profile-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 410, height: 600 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
const errors = [];
const externalRequests = [];
context.on("page", (page) =>
  page.on("pageerror", (error) => errors.push(error.message)),
);
context.on("request", (request) => {
  if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
});
try {
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  const extensions = await manager.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.developerPrivate.getExtensionsInfo(
          { includeDisabled: false, includeTerminated: false },
          resolve,
        );
      }),
  );
  const extension = extensions.find((item) => item.name.startsWith("Cep 2FA"));
  assert.ok(extension, "Chrome must load the actual unpacked extension");
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(59000));
  await page.goto(`chrome-extension://${extension.id}/popup.html`);
  const key = "cep2fa.accounts.v1";
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // Public RFC test key.
  const secondSecret = "JBSWY3DPEHPK3PXP";
  const expect = async (selector, predicate, message) => {
    await page.waitForFunction(
      ({ selector, predicate }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        if (predicate === "visible")
          return !el.hidden && el.getBoundingClientRect().height > 0;
        if (predicate === "hidden")
          return el.hidden || !el.getBoundingClientRect().height;
        return el.textContent === predicate;
      },
      { selector, predicate },
      { timeout: 8000 },
    );
    if (message) console.log(`PASS ${message}`);
  };
  await expect("#empty-state", "visible", "empty state");
  await page.screenshot({ path: path.join(results, "empty.png") });
  await page.locator("#add-first").click();
  await page.locator("#account-name").fill("Google · Personal");
  await page.locator("#account-secret").fill("INVALID-KEY");
  await page.locator("#save-account").click();
  await expect("#form-error", "visible", "invalid key validation");
  await page.locator("#account-secret").fill(secret.toLowerCase());
  assert.equal(
    await page.locator("#account-secret").getAttribute("type"),
    "password",
  );
  await page.locator("#toggle-secret").click();
  assert.equal(
    await page.locator("#account-secret").getAttribute("type"),
    "text",
  );
  await page.locator("#toggle-secret").click();
  await page.screenshot({ path: path.join(results, "add-account.png") });
  await page.locator("#save-account").click();
  await expect("#account-count", "1", "add account");
  await expect(".code-text", "287 082", "RFC code in real extension");
  await page.locator(".code-button").click();
  await expect("#toast", "Code copied", "clipboard action");
  // The production extension only needs clipboardWrite. Reading is test-only.
  await context.grantPermissions(["clipboard-read"]);
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "287082",
  );
  await page.clock.setFixedTime(new Date(60000));
  await expect(".code-text", "359 152", "automatic refresh at period boundary");
  await page.reload();
  await expect("#account-count", "1", "account persists when popup reopens");
  await page.locator("#add-account").click();
  await page.locator("#account-name").fill("Duplicate secret");
  await page.locator("#account-secret").fill(secret);
  await page.locator("#save-account").click();
  await expect(
    "#form-error",
    "This 2FA secret is already saved.",
    "duplicate prevention",
  );
  await page.locator("#cancel-dialog").click();
  await page.locator("#add-account").click();
  await page
    .locator("#account-secret")
    .fill(
      `otpauth://totp/GitHub%3Awork?secret=${secondSecret}&issuer=GitHub&digits=8&period=60`,
    );
  await page.locator("#save-account").click();
  await expect("#account-count", "2", "otpauth account with automatic name");
  assert.equal(
    await page.locator(".account-title").nth(1).textContent(),
    "GitHub:work",
  );
  assert.match(
    await page.locator(".code-text").nth(1).textContent(),
    /^\d{4} \d{4}$/,
  );
  await page.locator("#search").fill("gITHUB");
  assert.equal(await page.locator(".account-card:visible").count(), 1);
  await page.locator("#search").fill("no-such-account");
  await expect("#no-results", "visible", "search and no results");
  await page.locator("#search").fill("");
  await page
    .getByRole("button", { name: "Edit GitHub:work", exact: true })
    .click();
  await page.locator("#account-name").fill("GitHub · Work");
  await page.locator("#save-account").click();
  await page.waitForFunction(
    () => !document.querySelector("#account-dialog").open,
  );
  const saved = await page.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key],
    key,
  );
  assert.equal(saved[1].name, "GitHub · Work");
  assert.equal(saved[1].period, 60);
  assert.equal(saved[1].digits, 8);
  console.log("PASS edit preserves custom TOTP settings");
  await page
    .getByRole("button", { name: "Delete Google · Personal", exact: true })
    .click();
  await page.locator("#cancel-delete").click();
  assert.equal(await page.locator(".account-card").count(), 2);
  await page
    .getByRole("button", { name: "Delete Google · Personal", exact: true })
    .click();
  await page.locator("#confirm-delete").click();
  await expect("#account-count", "1", "delete requires confirmation");
  await page.locator("#add-account").click();
  await page.locator("#account-name").fill("<img src=x onerror=alert(1)>");
  await page.locator("#account-secret").fill(secret);
  await page.locator("#save-account").click();
  await expect("#account-count", "2");
  assert.equal(
    await page.locator(".account-title").nth(1).textContent(),
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(await page.locator(".account-title img").count(), 0);
  console.log("PASS account names cannot inject HTML");
  // Finish the screenshot with realistic names, using only public test keys.
  await page
    .getByRole("button", {
      name: "Edit <img src=x onerror=alert(1)>",
      exact: true,
    })
    .click();
  await page.locator("#account-name").fill("Google · Personal");
  await page.locator("#save-account").click();
  await page.waitForFunction(
    () => !document.querySelector("#account-dialog").open,
  );
  await page.evaluate(() => {
    document.querySelector("#toast").hidden = true;
  });
  await page.screenshot({ path: path.join(results, "accounts.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log("PASS no page errors, horizontal overflow, or external requests");
  console.log("Real unpacked Chromium extension: all checks passed.");
} finally {
  await context.close();
  // Only delete the disposable profile created inside this workspace's results folder.
  const resolvedProfile = path.resolve(profile);
  if (
    path.dirname(resolvedProfile) === path.resolve(results) &&
    path.basename(resolvedProfile).startsWith("profile-")
  ) {
    await rm(resolvedProfile, { recursive: true, force: true });
  }
}
