import type { Browser, Page } from "playwright";
import { CollectorFailure } from "./domain.js";

export interface YuntuCredentials {
  url: string;
  username: string;
  password: string;
}

export async function tryAutoLogin(
  browser: Browser,
  credentials: YuntuCredentials,
  logger: { log(msg: string): void } = console,
): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) {
    throw new CollectorFailure(
      "AUTH_REQUIRED",
      "No browser context available for auto-login",
    );
  }

  const page = await context.newPage();
  logger.log(`[yuntu] 正在打开登录页面...`);

  await page.goto(credentials.url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  if (
    currentUrl.includes("yuntu.oceanengine.com") &&
    !isLoginPage(currentUrl)
  ) {
    logger.log("[yuntu] 已登录，无需重复登录。");
    return page;
  }

  logger.log("[yuntu] 正在自动填写登录信息...");

  const usernameSelectors = [
    'input[name="email"]',
    'input[name="account"]',
    'input[name="username"]',
    'input[name="mobile"]',
    'input[placeholder*="邮箱"]',
    'input[placeholder*="手机"]',
    'input[placeholder*="账号"]',
    'input[placeholder*="用户名"]',
    'input[placeholder*="email"]',
    'input[type="text"]',
    'input[type="tel"]',
  ];

  let filled = false;
  for (const selector of usernameSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(credentials.username);
      filled = true;
      break;
    }
  }

  if (!filled) {
    await page.close();
    throw new CollectorFailure(
      "AUTH_REQUIRED",
      "无法找到用户名输入框，请手动登录",
    );
  }

  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await passwordInput.waitFor({ state: "visible", timeout: 5_000 });
    await passwordInput.fill(credentials.password);
  } catch {
    await page.close();
    throw new CollectorFailure(
      "AUTH_REQUIRED",
      "无法找到密码输入框，请手动登录",
    );
  }

  await page.waitForTimeout(500);

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("登录")',
    'button:has-text("登 录")',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'input[type="submit"]',
    '[class*="login-btn"]',
    '[class*="submit"]',
  ];

  let clicked = false;
  for (const selector of submitSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    await page.keyboard.press("Enter");
  }

  logger.log("[yuntu] 等待登录完成...");

  try {
    await page.waitForURL(
      (url) =>
        url.toString().includes("yuntu.oceanengine.com") &&
        !isLoginPage(url.toString()),
      { timeout: 30_000 },
    );
  } catch {
    const finalUrl = page.url();
    if (
      finalUrl.includes("yuntu.oceanengine.com") &&
      !isLoginPage(finalUrl)
    ) {
      logger.log("[yuntu] 自动登录成功。");
      return page;
    }

    await page.close();
    throw new CollectorFailure(
      "AUTH_REQUIRED",
      "自动登录超时，可能用户名或密码错误，请检查 .env 配置或手动登录",
    );
  }

  logger.log("[yuntu] 自动登录成功。");
  return page;
}

function isLoginPage(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/signin") ||
    lower.includes("/sign-in") ||
    lower.includes("/auth") ||
    lower.includes("/sso") ||
    lower.includes("/passport") ||
    lower.includes("account.oceanengine.com")
  );
}
