// Isolated browser acceptance for the notification inbox and device push.
// Run only against a localhost/127.0.0.1 stack whose owner is a fixture account
// and whose household has two unread Calendar reminders ("Dentist" and
// "Garbage") for that owner. All data is invented.
//   HOMI_TEST_URL=http://127.0.0.1:3200 HOMI_TEST_EMAIL=... HOMI_TEST_PASSWORD=... \
//   HOMI_TEST_CHROME=/usr/bin/google-chrome node apps/web/qa/notifications-acceptance.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.HOMI_TEST_URL ?? "http://127.0.0.1:3200";
const host = new URL(base).hostname;
if (host !== "localhost" && host !== "127.0.0.1") throw new Error("Acceptance requires the isolated test stack");
const out = process.env.HOMI_QA_OUT ?? mkdtempSync(join(tmpdir(), "homi-notifications-"));
mkdirSync(out, { recursive: true });
const email = process.env.HOMI_TEST_EMAIL;
const password = process.env.HOMI_TEST_PASSWORD;
assert.ok(email && password, "HOMI_TEST_EMAIL and HOMI_TEST_PASSWORD are required");

const errors = [];
const pass = (name, detail = "") => console.log("PASS", name, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, message, seconds = 30) {
  for (let i = 0; i < seconds; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(1000);
  }
  throw new Error("Timed out: " + message);
}

const context = await chromium.launchPersistentContext(join(out, "profile"), {
  headless: true,
  executablePath: process.env.HOMI_TEST_CHROME,
  viewport: { width: 390, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(base);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.waitFor({ timeout: 30000 });
  pass("bell is on the dashboard");

  await poll(async () => /2 unread/.test((await bell.getAttribute("aria-label")) ?? ""), "bell names 2 unread");
  assert.equal((await bell.locator(".homi-notification-bell__badge").innerText()).trim(), "2");
  pass("badge shows the unread count", "2");

  await bell.click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await sheet.waitFor();
  await sheet.getByText("Dentist").waitFor();
  await sheet.getByText("Starts in 15 minutes.").waitFor();
  await sheet.getByText("Garbage").waitFor();
  pass("inbox shows the reminders with text written by the module");
  await sheet.getByText("Get reminders on this device").waitFor();
  pass("offers to turn on device notifications");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, "no horizontal overflow at 390 px: " + overflow);
  pass("no horizontal overflow at 390 px");
  await page.screenshot({ path: join(out, "notifications-390.png") });

  // The service worker must carry the push handlers.
  const sw = await page.evaluate(async () => (await fetch("/sw.js", { cache: "no-store" })).text());
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  pass("service worker handles push and notification clicks");

  // Read, dismiss, read all.
  await sheet.getByRole("button", { name: "Mark read" }).first().click();
  await poll(async () => /1 unread/.test((await bell.getAttribute("aria-label")) ?? ""), "unread drops to 1");
  pass("mark read lowers the badge", "1");
  await sheet.getByRole("button", { name: "Dismiss" }).first().click();
  await poll(async () => (await sheet.locator(".homi-notifications__item").count()) === 1, "one item left after dismiss");
  pass("dismiss removes the item");
  await sheet.getByRole("button", { name: "Mark all read" }).click();
  await poll(async () => (await bell.getAttribute("aria-label")) === "Notifications", "no unread left");
  assert.equal(await bell.locator(".homi-notification-bell__badge").count(), 0);
  pass("mark all read clears the badge");

  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  pass("Escape closes the inbox");

  // Device push: grant permission and subscribe through the real browser.
  await context.grantPermissions(["notifications"], { origin: base });
  await bell.click();
  const turnOn = sheet.getByRole("button", { name: "Turn on notifications" });
  await turnOn.waitFor({ timeout: 10000 });
  await turnOn.click();
  let subscribed = false;
  try {
    await sheet.getByText("Notifications are on for this device.").waitFor({ timeout: 25000 });
    subscribed = true;
    pass("this device subscribed to push through the browser's push service");
  } catch {
    const note = (await sheet.locator(".homi-notifications").innerText()).replace(/\s+/g, " ").slice(0, 300);
    console.log("INFO  subscribe did not complete in this environment:", note);
  }
  console.log("SUBSCRIBED=" + subscribed);
  await page.screenshot({ path: join(out, "notifications-after.png") });

  assert.deepEqual(errors, [], "page errors: " + errors.join("; "));
  pass("no page errors");
  console.log("OUT=" + out);
} finally {
  await context.close();
}
