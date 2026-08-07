"use strict";

interface Credentials {
  email?: string;
  password?: string;
}

interface RequestOptions {
  method: string;
  url: string;
  data?: string;
  headers?: Record<string, string>;
  parseJson?: boolean;
  timeout?: number;
}

interface ApiResponse {
  code?: number;
  msg?: string;
  data?: unknown;
  signin?: boolean;
}

type SharedStatusPromise = Promise<ApiResponse> & { startedAt: number };

if (window.top === window && !window.__BLOGSCLUB_AUTO_SIGNIN__) {
  window.__BLOGSCLUB_AUTO_SIGNIN__ = true;

  const API = "https://www.blogsclub.org";
  const CAPTCHA_ID = "f70029ad5e8b031ff90bd54bce240f14";
  const DEFAULT_INTERVAL_MS = 10 * 1000; // 默认 10 秒
  const MIN_INTERVAL_MS = 1; // 最小 1 毫秒
  const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 最大 24 小时
  const DEFAULT_RUSH_LEAD_SECONDS = 5; // 默认零点前 5 秒打开验证码
  const MIN_RUSH_LEAD_SECONDS = 1; // 最小提前 1 秒
  const MAX_RUSH_LEAD_SECONDS = 60; // 最大提前 60 秒
  const DEFAULT_RUSH_SUBMIT_DELAY_MS = 500; // 默认服务端零点后 500 毫秒提交
  const MIN_RUSH_SUBMIT_DELAY_MS = 0;
  const MAX_RUSH_SUBMIT_DELAY_MS = 60 * 1000;
  const DEFAULT_RUSH_SUBMIT_RETRIES = 10; // 不含首次提交
  const MIN_RUSH_SUBMIT_RETRIES = 0;
  const MAX_RUSH_SUBMIT_RETRIES = 100;
  const DEFAULT_RUSH_SUBMIT_INTERVAL_MS = 200;
  const MIN_RUSH_SUBMIT_INTERVAL_MS = 1;
  const MAX_RUSH_SUBMIT_INTERVAL_MS = 60 * 1000;
  const KEYS = {
    credentials: "blogsclub-auto-signin-credentials",
    accountStatus: "blogsclub-auto-signin-account-status",
    interval: "blogsclub-auto-signin-interval-ms",
    blogsClubOnly: "blogsclub-auto-signin-blogsclub-only",
    autoPopup: "blogsclub-auto-signin-auto-popup",
    rushMode: "blogsclub-auto-signin-rush-mode",
    rushLeadSeconds: "blogsclub-auto-signin-rush-lead-seconds",
    rushSubmitDelayMs: "blogsclub-auto-signin-rush-submit-delay-ms",
    rushSubmitRetries: "blogsclub-auto-signin-rush-submit-retries",
    rushSubmitIntervalMs: "blogsclub-auto-signin-rush-submit-interval-ms",
    notifiedDate: "blogsclub-auto-signin-notified",
  };

  let checking = null;
  let signing = false;
  let loginPromise = null;
  let loginPagePromise = null;
  let signinStatusPromise = null;
  let signinStatusForce = false;
  let captcha = null;
  let captchaLoading = null;
  let captchaOpening = false;
  let intervalMenuId = null;
  let accountMenuId = null;
  let blogsClubOnlyMenuId = null;
  let autoPopupMenuId = null;
  let rushModeMenuId = null;
  let rushLeadMenuId = null;
  let rushSubmitDelayMenuId = null;
  let rushSubmitRetriesMenuId = null;
  let rushSubmitIntervalMenuId = null;
  let rushTimer = null;
  let rushSubmitTimer = null;
  // 用对象身份隔离并发回包，旧轮次不能影响新轮次的重试定时器。
  let rushSubmitState = null;
  let rushCaptchaPending = false;
  // 验证码回调属于哪个 rush 流程；取消后保留旧值，使迟到回调被丢弃而非普通提交。
  let rushCaptchaGeneration = null;
  let rushSubmitAt = 0;
  let rushTargetMidnight = 0;
  let rushPreparing = null;
  let rushPreparingGeneration = 0;
  let rushPreparingTargetMidnight = 0;
  let rushScheduleGeneration = 0; // 异步校准完成后只接受最新调度代号。
  // 仅在关闭或手动重排时变更；次日排程不能误停当日仍在返回的重试请求。
  let rushFlowGeneration = 0;
  let signinSuccessSerial = 0;
  let lastSigninSuccessAt = 0;
  let serverClockOffsetMs = null;

  // 本地配置与油猴菜单。
  /**
   * 显示油猴通知；没有通知 API 时退回控制台。
   *
   * @param {string} text 通知正文。
   * @param {string} [title="BlogsClub 签到"] 通知标题。. Default is `"BlogsClub 签到"`
   * @returns {void}
   */
  function notify(text, title = "BlogsClub 签到") {
    if (typeof GM_notification === "function") {
      GM_notification({ title, text, timeout: 5000 });
    } else {
      console.info(`[${title}] ${text}`);
    }
  }

  /**
   * 格式化签到状态检查耗时。
   *
   * @param {number} milliseconds 耗时，单位为毫秒。
   * @returns {string} 面向用户的耗时文本。
   */
  function formatDuration(milliseconds) {
    if (milliseconds >= 1000) {
      return `${Number((milliseconds / 1000).toFixed(2))} 秒`;
    }
    return `${Math.round(milliseconds)} 毫秒`;
  }

  /**
   * 注册或替换一个油猴菜单项。
   *
   * @param {number | string | null | undefined} currentId 旧菜单编号。
   * @param {string} label 菜单显示文本。
   * @param {Function} handler 点击菜单后的处理函数。
   * @returns {number | string | undefined} 新菜单编号。
   */
  function registerMenu(currentId, label, handler) {
    if (currentId !== null && currentId !== undefined && typeof GM_unregisterMenuCommand === "function") {
      GM_unregisterMenuCommand(currentId);
    }
    return GM_registerMenuCommand(label, handler);
  }

  /**
   * 读取 BlogsClub 登录凭据。
   *
   * @returns {{ email?: string; password?: string }} 本地保存的凭据。
   */
  function credentials(): Credentials {
    return GM_getValue<Credentials>(KEYS.credentials, {}) || {};
  }

  /**
   * 判断是否已保存完整 BlogsClub 登录凭据。
   *
   * @returns {boolean} 邮箱和密码是否都存在。
   */
  function hasCredentials() {
    const { email, password } = credentials();
    return Boolean(email && password);
  }

  /**
   * 通过菜单配置 BlogsClub 账号，并立即触发一次检查。
   *
   * @returns {void}
   */
  function configureAccount() {
    const current = credentials();
    const email = prompt("BlogsClub 登录邮箱", current.email || "");
    if (email === null) return;
    const password = prompt("BlogsClub 登录密码", "");
    if (password === null) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) {
      notify("邮箱或密码不能为空", "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.credentials, { email: email.trim(), password });
    GM_setValue(KEYS.accountStatus, "已保存");
    registerAccountMenu();
    notify("账号已保存", "BlogsClub 配置");
    if (rushModeEnabled()) {
      // 凭据变更后，旧验证码和旧会话请求不能继续提交到新账号流程。
      restartRushCheck();
    }
    check();
  }

  /**
   * 读取并校验轮询周期。
   *
   * @returns {number} 合法的毫秒数；非法值使用默认值。
   */
  function intervalMs() {
    const value = Number(GM_getValue(KEYS.interval, DEFAULT_INTERVAL_MS));
    return Number.isSafeInteger(value) && value >= MIN_INTERVAL_MS && value <= MAX_INTERVAL_MS
      ? value
      : DEFAULT_INTERVAL_MS;
  }

  /**
   * 通过菜单配置轮询周期，单位为毫秒。
   *
   * @returns {void}
   */
  function configureInterval() {
    const input = prompt(`检查周期（毫秒，${MIN_INTERVAL_MS}～${MAX_INTERVAL_MS}）`, String(intervalMs()));
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) {
      notify(`请输入 ${MIN_INTERVAL_MS}～${MAX_INTERVAL_MS} 的整数`, "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.interval, value);
    registerIntervalMenu();
    notify(`检查周期已设置为 ${value} 毫秒`, "BlogsClub 配置");
    check();
  }

  /**
   * 判断未签到时是否自动打开验证码。
   *
   * @returns {boolean} 是否启用自动弹窗。
   */
  function autoPopupEnabled() {
    return GM_getValue<boolean>(KEYS.autoPopup, false) === true;
  }

  /**
   * 判断是否启用零点抢签到模式。
   *
   * @returns {boolean} 是否启用抢签到模式。
   */
  function rushModeEnabled() {
    return GM_getValue<boolean>(KEYS.rushMode, false) === true;
  }

  /**
   * 读取零点抢签到的提前秒数。
   *
   * @returns {number} 合法的提前秒数；非法值使用默认值。
   */
  function rushLeadSeconds() {
    const value = Number(GM_getValue(KEYS.rushLeadSeconds, DEFAULT_RUSH_LEAD_SECONDS));
    return Number.isSafeInteger(value) && value >= MIN_RUSH_LEAD_SECONDS && value <= MAX_RUSH_LEAD_SECONDS
      ? value
      : DEFAULT_RUSH_LEAD_SECONDS;
  }

  /**
   * 读取零点抢签到提交延迟。
   *
   * @returns {number} 合法的毫秒数；非法值使用默认值。
   */
  function rushSubmitDelayMs() {
    const value = Number(GM_getValue(KEYS.rushSubmitDelayMs, DEFAULT_RUSH_SUBMIT_DELAY_MS));
    return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_DELAY_MS && value <= MAX_RUSH_SUBMIT_DELAY_MS
      ? value
      : DEFAULT_RUSH_SUBMIT_DELAY_MS;
  }

  /**
   * 读取零点抢签到提交重试次数（不含首次提交）。
   *
   * @returns {number} 合法的重试次数；非法值使用默认值。
   */
  function rushSubmitRetries() {
    const value = Number(GM_getValue(KEYS.rushSubmitRetries, DEFAULT_RUSH_SUBMIT_RETRIES));
    return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_RETRIES && value <= MAX_RUSH_SUBMIT_RETRIES
      ? value
      : DEFAULT_RUSH_SUBMIT_RETRIES;
  }

  /**
   * 读取零点抢签到提交重试间隔。
   *
   * @returns {number} 合法的毫秒数；非法值使用默认值。
   */
  function rushSubmitIntervalMs() {
    const value = Number(GM_getValue(KEYS.rushSubmitIntervalMs, DEFAULT_RUSH_SUBMIT_INTERVAL_MS));
    return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_INTERVAL_MS && value <= MAX_RUSH_SUBMIT_INTERVAL_MS
      ? value
      : DEFAULT_RUSH_SUBMIT_INTERVAL_MS;
  }

  /**
   * 判断当前页面是否属于 BlogsClub。
   *
   * @returns {boolean} 是否为 BlogsClub 页面。
   */
  function isBlogsClubPage() {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === "blogsclub.org" || hostname.endsWith(".blogsclub.org");
  }

  /**
   * 判断是否只在 BlogsClub 页面执行检查。
   *
   * @returns {boolean} 是否限制在 BlogsClub 页面。
   */
  function blogsClubOnlyEnabled() {
    return GM_getValue(KEYS.blogsClubOnly, true) === true;
  }

  /**
   * 读取账号菜单应显示的登录状态。
   *
   * @returns {string} 未设置、已保存、登录失败或已登录。
   */
  function accountStatus(): string {
    if (!hasCredentials()) return "未设置";
    return GM_getValue(KEYS.accountStatus, "已保存");
  }

  /**
   * 注册显示当前检查周期的动态菜单。
   *
   * @returns {void}
   */
  function registerIntervalMenu() {
    intervalMenuId = registerMenu(intervalMenuId, `检查周期：${intervalMs()} 毫秒`, configureInterval);
  }

  /**
   * 注册显示账号状态的动态菜单。
   *
   * @returns {void}
   */
  function registerAccountMenu() {
    accountMenuId = registerMenu(accountMenuId, `BlogsClub 账号：${accountStatus()}`, configureAccount);
  }

  /**
   * 注册仅在 BlogsClub 页面检查的开关菜单。
   *
   * @returns {void}
   */
  function registerBlogsClubOnlyMenu() {
    blogsClubOnlyMenuId = registerMenu(
      blogsClubOnlyMenuId,
      `仅在 BlogsClub 页面检查：${blogsClubOnlyEnabled() ? "启用" : "关闭"}`,
      toggleBlogsClubOnly,
    );
  }

  /**
   * 注册自动验证码弹窗开关菜单。
   *
   * @returns {void}
   */
  function registerAutoPopupMenu() {
    autoPopupMenuId = registerMenu(
      autoPopupMenuId,
      `可签到时自动验证码弹窗：${autoPopupEnabled() ? "启用" : "关闭"}`,
      toggleAutoPopup,
    );
  }

  /**
   * 注册零点抢签到模式菜单。
   *
   * @returns {void}
   */
  function registerRushModeMenu() {
    rushModeMenuId = registerMenu(
      rushModeMenuId,
      `零点抢签到模式：${rushModeEnabled() ? "启用" : "关闭"}`,
      toggleRushMode,
    );
  }

  /**
   * 注册零点抢签到提前加载验证码时间菜单。
   *
   * @returns {void}
   */
  function registerRushLeadMenu() {
    rushLeadMenuId = registerMenu(rushLeadMenuId, `抢签到提前加载验证码：${rushLeadSeconds()} 秒`, configureRushLead);
  }

  /**
   * 通过菜单配置抢签到提前加载验证码时间，单位为秒。
   *
   * @returns {void}
   */
  function configureRushLead() {
    const input = prompt(
      `抢签到提前加载验证码时间（秒，${MIN_RUSH_LEAD_SECONDS}～${MAX_RUSH_LEAD_SECONDS}）`,
      String(rushLeadSeconds()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_LEAD_SECONDS || value > MAX_RUSH_LEAD_SECONDS) {
      notify(`请输入 ${MIN_RUSH_LEAD_SECONDS}～${MAX_RUSH_LEAD_SECONDS} 的整数秒数`, "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.rushLeadSeconds, value);
    registerRushLeadMenu();
    notify(`抢签到提前加载验证码时间已设置为 ${value} 秒`, "BlogsClub 配置");
    if (rushModeEnabled()) restartRushCheck();
  }

  /**
   * 注册零点抢签到提交延迟菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitDelayMenu() {
    rushSubmitDelayMenuId = registerMenu(
      rushSubmitDelayMenuId,
      `抢签到提交延迟：${rushSubmitDelayMs()} 毫秒`,
      configureRushSubmitDelay,
    );
  }

  /**
   * 通过菜单配置零点抢签到提交延迟，单位为毫秒。
   *
   * @returns {void}
   */
  function configureRushSubmitDelay() {
    const input = prompt(
      `抢签到提交延迟（毫秒，${MIN_RUSH_SUBMIT_DELAY_MS}～${MAX_RUSH_SUBMIT_DELAY_MS}）`,
      String(rushSubmitDelayMs()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_DELAY_MS || value > MAX_RUSH_SUBMIT_DELAY_MS) {
      notify(`请输入 ${MIN_RUSH_SUBMIT_DELAY_MS}～${MAX_RUSH_SUBMIT_DELAY_MS} 的整数毫秒数`, "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.rushSubmitDelayMs, value);
    registerRushSubmitDelayMenu();
    notify(`抢签到提交延迟已设置为 ${value} 毫秒`, "BlogsClub 配置");
    if (rushModeEnabled()) restartRushCheck();
  }

  /**
   * 注册零点抢签到提交重试次数菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitRetriesMenu() {
    rushSubmitRetriesMenuId = registerMenu(
      rushSubmitRetriesMenuId,
      `抢签到提交重试次数：${rushSubmitRetries()} 次`,
      configureRushSubmitRetries,
    );
  }

  /**
   * 通过菜单配置零点抢签到提交重试次数。
   *
   * @returns {void}
   */
  function configureRushSubmitRetries() {
    const input = prompt(
      `抢签到提交重试次数（不含首次提交，${MIN_RUSH_SUBMIT_RETRIES}～${MAX_RUSH_SUBMIT_RETRIES}）`,
      String(rushSubmitRetries()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_RETRIES || value > MAX_RUSH_SUBMIT_RETRIES) {
      notify(`请输入 ${MIN_RUSH_SUBMIT_RETRIES}～${MAX_RUSH_SUBMIT_RETRIES} 的整数次数`, "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.rushSubmitRetries, value);
    registerRushSubmitRetriesMenu();
    notify(`抢签到提交重试次数已设置为 ${value} 次`, "BlogsClub 配置");
  }

  /**
   * 注册零点抢签到提交重试间隔菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitIntervalMenu() {
    rushSubmitIntervalMenuId = registerMenu(
      rushSubmitIntervalMenuId,
      `抢签到提交重试间隔：${rushSubmitIntervalMs()} 毫秒`,
      configureRushSubmitInterval,
    );
  }

  /**
   * 通过菜单配置零点抢签到提交重试间隔，单位为毫秒。
   *
   * @returns {void}
   */
  function configureRushSubmitInterval() {
    const input = prompt(
      `抢签到提交重试间隔（毫秒，${MIN_RUSH_SUBMIT_INTERVAL_MS}～${MAX_RUSH_SUBMIT_INTERVAL_MS}）`,
      String(rushSubmitIntervalMs()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_INTERVAL_MS || value > MAX_RUSH_SUBMIT_INTERVAL_MS) {
      notify(`请输入 ${MIN_RUSH_SUBMIT_INTERVAL_MS}～${MAX_RUSH_SUBMIT_INTERVAL_MS} 的整数毫秒数`, "BlogsClub 配置");
      return;
    }
    GM_setValue(KEYS.rushSubmitIntervalMs, value);
    registerRushSubmitIntervalMenu();
    notify(`抢签到提交重试间隔已设置为 ${value} 毫秒`, "BlogsClub 配置");
  }

  /**
   * 切换未签到时的验证码自动弹窗。
   *
   * @returns {void}
   */
  function toggleAutoPopup() {
    const enabled = !autoPopupEnabled();
    GM_setValue(KEYS.autoPopup, enabled);
    registerAutoPopupMenu();
    notify(`自动验证码弹窗已${enabled ? "开启" : "关闭"}`, "BlogsClub 配置");
    if (enabled) check(true);
  }

  /**
   * 切换是否仅在 BlogsClub 页面执行检查。
   *
   * @returns {void}
   */
  function toggleBlogsClubOnly() {
    const enabled = !blogsClubOnlyEnabled();
    GM_setValue(KEYS.blogsClubOnly, enabled);
    registerBlogsClubOnlyMenu();
    notify(`仅在 BlogsClub 页面检查已${enabled ? "开启" : "关闭"}`, "BlogsClub 配置");
    if (rushModeEnabled()) {
      // 页面范围改变后，旧 rush 流程不能继续按过期的页面许可提交。
      if (enabled && !isBlogsClubPage()) {
        cancelRushMode();
      } else {
        restartRushCheck();
      }
    }
    check();
  }

  /**
   * 切换零点抢签到模式。
   *
   * @returns {void}
   */
  function toggleRushMode() {
    const enabled = !rushModeEnabled();
    GM_setValue(KEYS.rushMode, enabled);
    registerRushModeMenu();
    notify(`零点抢签到模式已${enabled ? "开启" : "关闭"}`, "BlogsClub 配置");
    if (enabled) {
      scheduleRushCheck();
    } else {
      cancelRushMode();
    }
  }

  /**
   * 保存账号状态，并在状态变化时刷新菜单。
   *
   * @param {string} status 新状态。
   * @returns {void}
   */
  function setAccountStatus(status) {
    if (accountStatus() === status) return;
    GM_setValue(KEYS.accountStatus, status);
    registerAccountMenu();
  }

  // 网络请求与 BlogsClub 接口。
  /**
   * 从 HTTP Date 响应头校准 BlogsClub 服务端时钟。
   *
   * @param {object} response GM_xmlhttpRequest 响应对象。
   * @param {number} startedAt 请求发出时间。
   * @param {number} receivedAt 收到响应时间。
   * @returns {void}
   */
  function updateServerClock(response, startedAt, receivedAt) {
    const date = String(response.responseHeaders || "").match(/^date:\s*(.+)$/im)?.[1];
    const serverTime = date ? Date.parse(date) : NaN;
    if (Number.isFinite(serverTime)) {
      serverClockOffsetMs = serverTime - (startedAt + receivedAt) / 2;
    }
  }

  /**
   * 使用 GM_xmlhttpRequest 发送请求，并统一处理 HTTP、超时和 JSON 错误。
   *
   * @param {object} options 请求选项。
   * @param {string} options.method HTTP 方法。
   * @param {string} options.url 请求地址。
   * @param {string} [options.data] 请求正文。
   * @param {object} [options.headers] 请求头。
   * @param {boolean} [options.parseJson=true] 是否解析 JSON 响应。. Default is `true`
   * @param {number} [options.timeout=20000] 超时时间，单位为毫秒。. Default is `20000`
   * @returns {Promise<object | string>} 接口返回对象或原始文本。
   */
  function request(options: RequestOptions & { parseJson: false }): Promise<string>;
  function request(options: RequestOptions): Promise<ApiResponse>;
  function request({
    method,
    url,
    data,
    headers,
    parseJson = true,
    timeout = 20000,
  }: RequestOptions): Promise<ApiResponse | string> {
    return new Promise<ApiResponse | string>((resolve, reject) => {
      const startedAt = Date.now();
      GM_xmlhttpRequest({
        method,
        url,
        data,
        anonymous: false,
        headers: headers || (data ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : undefined),
        timeout,
        onload(response) {
          updateServerClock(response, startedAt, Date.now());
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          const text = String(response.responseText || "").trim();
          if (!text) {
            reject(new Error("未登录或接口无响应"));
            return;
          }
          if (!parseJson) {
            resolve(text);
            return;
          }
          try {
            resolve(JSON.parse(text) as ApiResponse);
          } catch {
            reject(new Error("接口返回格式异常"));
          }
        },
        onerror: () => reject(new Error("网络请求失败")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  /**
   * 将对象编码为表单请求正文。
   *
   * @param {object} data 表单字段。
   * @returns {string} Application/x-www-form-urlencoded 字符串。
   */
  function form(data) {
    return new URLSearchParams(data).toString();
  }

  /**
   * 共享进行中的登录页请求；响应正文同时供时钟校准和登录取 token。
   *
   * @returns {Promise<string>} 登录页正文。
   */
  function loginPage() {
    if (!loginPagePromise) {
      loginPagePromise = request({
        method: "GET",
        url: `${API}/login.html`,
        parseJson: false,
      }).finally(() => {
        loginPagePromise = null;
      });
    }
    return loginPagePromise;
  }

  /**
   * 获取登录页令牌并登录 BlogsClub。
   *
   * @returns {Promise<void>} 登录成功或抛出错误。
   */
  async function login() {
    const { email, password } = credentials();
    if (!hasCredentials()) throw new Error("请先设置 BlogsClub 账号");

    const page = await loginPage();
    const token = page.match(/window\.bcToken\s*=\s*["']([^"']+)["']/)?.[1];
    if (!token) throw new Error("未找到登录令牌");

    const result = await request({
      method: "POST",
      url: `${API}/index.php/getLogin`,
      data: form({ type: "password", email, password, token }),
    });
    if (result.code !== 1) throw new Error(result.msg || "登录失败");
  }

  /**
   * 调用 BlogsClub 用户资料接口。
   *
   * @param {string} action 接口动作。
   * @param {object} [extra={}] 额外表单字段。. Default is `{}`
   * @returns {Promise<object>} 接口 JSON 响应。
   */
  function profile(action, extra = {}) {
    return request({
      method: "POST",
      url: `${API}/index.php/getProfile`,
      data: form({ action, ...extra }),
    });
  }

  /**
   * 获取当前账号在今日签到榜中的名次。
   *
   * @returns {Promise<string>} 排名提示文本。
   */
  async function signinRankText() {
    try {
      const [result, page] = await Promise.all([
        profile("signinRank"),
        request({
          method: "GET",
          url: `${API}/usercenter.html`,
          parseJson: false,
        }),
      ]);
      if (result.code !== 1) return "今日签到排名暂不可用";
      const ranking = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
      const blogId = page.match(/id=["']personPage["'][^>]*\/blog\/(\d+)\.html/i)?.[1];
      if (!Array.isArray(ranking) || !blogId) return "今日签到排名暂不可用";
      const index = ranking.findIndex((user) => String(user.blog_id) === blogId);
      return index >= 0 ? `今日签到排名第 ${index + 1} 名` : "今日签到未进入前 20 名";
    } catch {
      return "今日签到排名暂不可用";
    }
  }

  /**
   * 查询签到状态；必要时先用已保存凭据登录。
   *
   * @param {boolean} [forceLogin=false] 是否跳过现有会话并重新登录。. Default is `false`
   * @returns {Promise<object>} 包含 signin 字段的接口响应。
   */
  async function signinStatus(forceLogin = false) {
    let result;
    if (!forceLogin) {
      try {
        result = await profile("signinStatus");
        if (result.code === 1) return result;
      } catch {
        // Retry with saved credentials below.
      }
    }
    if (!loginPromise) {
      loginPromise = login().finally(() => {
        loginPromise = null;
      });
    }
    await loginPromise;
    result = await profile("signinStatus");
    if (result.code !== 1) throw new Error(result.msg || "登录状态失效");
    return result;
  }

  /**
   * 共享进行中的签到状态流程；强制登录请求不复用普通状态请求。
   *
   * @param {boolean} [forceLogin=false] 是否跳过现有会话并重新登录。. Default is `false`
   * @returns {Promise<object>} 包含 signin 字段的接口响应。
   */
  function sharedSigninStatus(forceLogin = false) {
    if (signinStatusPromise && (!forceLogin || signinStatusForce)) {
      return signinStatusPromise;
    }
    const startedAt = serverNow();
    const promise = signinStatus(forceLogin);
    const shared = promise.finally(() => {
      // 较早请求收尾时不能清空后来替代它的共享请求。
      if (signinStatusPromise === shared) {
        signinStatusPromise = null;
        signinStatusForce = false;
      }
    }) as SharedStatusPromise;
    // 共享调用方必须使用最初请求的时间，不能用各自 await 前的时间覆盖它。
    shared.startedAt = startedAt;
    signinStatusPromise = shared;
    signinStatusForce = forceLogin;
    return shared;
  }

  // Geetest 加载和人工验证。
  /**
   * 判断当前页面是否已有可见的 Geetest 弹窗。
   *
   * @returns {boolean} 是否存在可见验证码节点。
   */
  function hasVisibleCaptcha() {
    return [
      ...document.querySelectorAll(
        '[class*="geetest"], [id*="geetest"], [class*="geevisit"], [id*="geevisit"], ' +
          '[data-geetest], [data-geetest-id], iframe[src*="geetest"], ' +
          'iframe[src*="geevisit"], iframe[src*="captcha"]',
      ),
    ].some((element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const htmlElement = element as HTMLElement;
      return (rect.width > 0 && rect.height > 0) || (htmlElement.offsetWidth > 0 && htmlElement.offsetHeight > 0);
    });
  }

  /**
   * 获取页面或油猴沙箱中的 Geetest 初始化函数。
   *
   * @returns {Function | null} InitGeetest4 函数。
   */
  function geetestInit() {
    if (typeof unsafeWindow.initGeetest4 === "function") return unsafeWindow.initGeetest4;
    if (typeof window.initGeetest4 === "function") return window.initGeetest4;
    return null;
  }

  /**
   * 按需加载 Geetest v4 脚本，并合并并发加载请求。
   *
   * @returns {Promise<void>} 脚本加载完成。
   */
  function loadCaptcha() {
    if (geetestInit()) return Promise.resolve();
    if (captchaLoading) return captchaLoading;
    captchaLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://static.geetest.com/v4/gt4.js";
      script.onload = () =>
        setTimeout(() => {
          if (geetestInit()) {
            resolve();
          } else {
            reject(new Error("验证码组件未加载"));
          }
        }, 0);
      script.onerror = () => reject(new Error("验证码组件加载失败"));
      (document.head || document.documentElement).appendChild(script);
    }).finally(() => {
      captchaLoading = null;
    });
    return captchaLoading;
  }

  /**
   * 初始化并打开人工 Geetest 验证码。
   *
   * @returns {Promise<void>} 验证窗口处理完成。
   */
  async function openCaptcha() {
    if (signing || captchaOpening || hasVisibleCaptcha()) return;
    captchaOpening = true;
    try {
      await loadCaptcha();
      // 加载期间可能已关闭或重排 rush；旧流程不能在等待结束后再显示验证码。
      if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !rushCaptchaPending))
        return;
      if (!captcha) {
        const init = geetestInit();
        if (!init) throw new Error("验证码组件未加载");
        captcha = await new Promise<CaptchaInstance>((resolve, reject) => {
          init({ captchaId: CAPTCHA_ID, product: "bind", language: "zho", riskType: "slide" }, (instance) => {
            instance
              .onReady(() => resolve(instance))
              .onError(reject)
              .onSuccess(() => handleCaptchaSuccess(instance.getValidate()));
          });
        });
      }
      // 初始化回调本身也可能跨过取消边界，再次确认验证码仍归当前 rush。
      if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !rushCaptchaPending))
        return;
      captcha.showCaptcha();
    } catch (error) {
      // Geetest 可能已插入弹窗后才回调异常，不能因此重复弹错。
      if (!hasVisibleCaptcha()) notify(error.message || "验证码加载失败");
    } finally {
      captchaOpening = false;
    }
  }

  /**
   * 提交一次验证码签到请求。
   *
   * @param {object} validation Geetest v4 或 v3 验证结果。
   * @returns {Promise<object>} 签到接口响应。
   */
  function submitSignin(validation) {
    return profile("signin", {
      verify_bind_token_sign: JSON.stringify({ ...validation, captcha_id: CAPTCHA_ID }),
    });
  }

  /**
   * 处理成功签到后的排名和提示。
   *
   * @param {object} result 签到接口响应。
   * @returns {Promise<void>} 提示处理完成。
   */
  async function finishSignSuccess(result, submittedAt = serverNow()) {
    signinSuccessSerial += 1;
    lastSigninSuccessAt = submittedAt;
    stopRushForKnownSignin(submittedAt);
    // 提交已确认成功；先释放当前验证码，避免慢排名请求重置后续验证码。
    captcha?.reset?.();
    const rankText = await signinRankText();
    notify(`${result.msg || "签到成功"}，${rankText}`);
  }

  /**
   * 提交验证码结果完成签到。
   *
   * @param {object} validation Geetest v4 或 v3 验证结果。
   * @returns {Promise<void>} 签到请求完成。
   */
  async function sign(validation) {
    if (signing || !validation) return;
    signing = true;
    const submittedAt = serverNow();
    try {
      const result = await submitSignin(validation);
      if (result.code !== 1) throw new Error(result.msg || "签到失败");
      await finishSignSuccess(result, submittedAt);
    } catch (error) {
      notify(error.message || "签到失败");
      captcha?.reset?.();
    } finally {
      signing = false;
      // 普通提交占用验证码期间 rush 可能已完成准备；释放占用后补开当前验证码。
      if (rushCaptchaPending) {
        openCaptchaWindow(true, rushCaptchaGeneration);
      }
    }
  }

  /**
   * 返回按服务端时钟校准后的当前时间戳。
   *
   * @returns {number} 服务端当前时间戳。
   */
  function serverNow() {
    return Date.now() + (serverClockOffsetMs || 0);
  }

  /**
   * 计算下一次服务端零点的时间戳。
   *
   * @returns {number} 下一次服务端零点的服务端时间戳。
   */
  function nextServerMidnight() {
    const now = new Date(serverNow());
    now.setHours(24, 0, 0, 0);
    return now.getTime();
  }

  /**
   * 请求一次 BlogsClub 页面，以便刷新 HTTP Date 时钟校准。
   *
   * @returns {Promise<void>} 校准请求完成。
   */
  async function calibrateServerClock() {
    try {
      await loginPage();
    } catch {
      // 后续仍可使用最近一次校准或本机时间。
    }
  }

  /**
   * 清理当前 rush 流程，但保留次日排程定时器。
   *
   * @returns {void}
   */
  function clearRushFlow() {
    const hadRushSubmission = rushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null;
    if (rushSubmitTimer !== null) clearTimeout(rushSubmitTimer);
    if (rushSubmitState) rushSubmitState.finished = true;
    rushSubmitTimer = null;
    rushSubmitState = null;
    rushCaptchaPending = false;
    rushSubmitAt = 0;
    rushTargetMidnight = 0;
    rushPreparing = null;
    rushPreparingGeneration = 0;
    rushPreparingTargetMidnight = 0;
    if (hadRushSubmission) {
      // 取消时重置 rush 验证码，迟到的 onSuccess 会因保留的归属代号被丢弃。
      captcha?.reset?.();
    }
  }

  /**
   * 普通流程确认当前日已签到时，停止同日的 rush 提交。
   *
   * @param {number} submittedAt 状态检查或签到请求开始时的服务端时间。
   * @returns {void}
   */
  function stopRushForKnownSignin(submittedAt) {
    if (!rushTargetMidnight || submittedAt < rushTargetMidnight) return;
    // 只有请求在目标零点之后发起，才足以证明是第二天的成功状态。
    clearRushFlow();
  }

  /**
   * 取消抢签到模式的定时器和待提交结果。
   *
   * @returns {void}
   */
  function cancelRushMode() {
    // 两个代号分别隔离排程校准和当前流程；迟到回调不能复活旧流程。
    rushScheduleGeneration += 1;
    rushFlowGeneration += 1;
    if (rushTimer !== null) clearTimeout(rushTimer);
    rushTimer = null;
    clearRushFlow();
  }

  /**
   * 配置或页面范围变化后的抢签到重排；旧流程必须先失效。
   *
   * @returns {void}
   */
  function restartRushCheck() {
    cancelRushMode();
    scheduleRushCheck();
  }

  /**
   * 结束一轮抢签到提交，并停止尚未发出的请求。
   *
   * @param {object} state 本轮提交状态。
   * @param {object | null} result 成功的签到接口响应；失败时传 null。
   * @returns {void}
   */
  function finishRushSubmit(state, result) {
    // 旧轮次的并发响应不能停止当前轮次的定时器或覆盖其结果。
    if (rushSubmitState !== state || state.finished) return;
    const ownsTarget = rushTargetMidnight === state.targetMidnight;
    state.finished = true;
    rushSubmitState = null;
    if (rushSubmitTimer !== null) clearTimeout(rushSubmitTimer);
    rushSubmitTimer = null;
    if (ownsTarget) {
      rushSubmitAt = 0;
      rushTargetMidnight = 0;
    }
    if (result) {
      void finishSignSuccess(result, state.firstSubmittedAt);
      return;
    }
    notify(state.lastError?.message || "签到失败");
    captcha?.reset?.();
  }

  /**
   * 在所有计划请求都发出且完成后报告失败。
   *
   * @param {object} state 本轮提交状态。
   * @returns {void}
   */
  function finishRushSubmitIfDone(state) {
    if (state.sent < state.totalAttempts || state.pending > 0) return;
    finishRushSubmit(state, null);
  }

  /**
   * 按固定间隔发起抢签到提交，不等待前一个请求返回。
   *
   * @param {object} validation Geetest 验证结果。
   * @param {number} flowGeneration 当前 rush 流程代号。
   * @param {number} targetMidnight 本轮服务端零点时间戳。
   * @returns {void}
   */
  function startRushSubmit(validation, flowGeneration, targetMidnight) {
    if (!validation || flowGeneration !== rushFlowGeneration || rushSubmitState !== null) return;
    const state = {
      totalAttempts: rushSubmitRetries() + 1,
      intervalMs: rushSubmitIntervalMs(),
      flowGeneration,
      targetMidnight,
      firstSubmittedAt: serverNow(),
      sent: 0,
      pending: 0,
      finished: false,
      lastError: null,
    };
    rushSubmitState = state;

    const isCurrent = () => rushSubmitState === state && !state.finished && state.flowGeneration === rushFlowGeneration;
    const submit = () => {
      if (!isCurrent()) return;
      state.sent += 1;
      state.pending += 1;
      Promise.resolve()
        .then(() => submitSignin(validation))
        .then(
          (result) => {
            state.pending -= 1;
            if (!isCurrent()) return;
            if (result?.code === 1) {
              finishRushSubmit(state, result);
              return;
            }
            state.lastError = new Error(result?.msg || "签到失败");
            finishRushSubmitIfDone(state);
          },
          (error) => {
            state.pending -= 1;
            if (!isCurrent()) return;
            state.lastError = error instanceof Error ? error : new Error("签到失败");
            finishRushSubmitIfDone(state);
          },
        );
      if (state.sent < state.totalAttempts && isCurrent()) {
        // 只绑定本状态的定时器；取消后即使回调已入队也不能碰新一轮。
        const timer = setTimeout(() => {
          if (rushSubmitTimer === timer) rushSubmitTimer = null;
          submit();
        }, state.intervalMs);
        rushSubmitTimer = timer;
      } else {
        rushSubmitTimer = null;
        finishRushSubmitIfDone(state);
      }
    };

    submit();
  }

  /**
   * 在零点前准备验证码；验证码完成后由 handleCaptchaSuccess 延迟提交并重试。
   *
   * @param {number} submitAt 零点后提交的服务端时间戳。
   * @param {number} targetMidnight 本轮服务端零点时间戳。
   * @param {number} flowGeneration 本轮 rush 流程代号。
   * @returns {Promise<void>} 准备流程完成。
   */
  async function prepareRushCaptcha(submitAt, targetMidnight, flowGeneration) {
    // 网络等待期间可能发生重排；旧流程只能退出，不能写入当前 rush 状态。
    if (
      flowGeneration !== rushFlowGeneration ||
      !rushModeEnabled() ||
      (blogsClubOnlyEnabled() && !isBlogsClubPage()) ||
      (rushTargetMidnight === targetMidnight &&
        (rushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null)) ||
      (rushPreparing && rushPreparingGeneration === flowGeneration && rushPreparingTargetMidnight === targetMidnight)
    ) {
      return;
    }
    if (
      rushTargetMidnight !== 0 &&
      rushTargetMidnight !== targetMidnight &&
      (rushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null)
    ) {
      // 新日期不能复用上一日的验证码或重试；旧回调由清理后的身份守卫隔离。
      clearRushFlow();
    }
    rushSubmitAt = submitAt;
    rushTargetMidnight = targetMidnight;
    const successSerialAtStart = signinSuccessSerial;
    const preparing = (async () => {
      const captchaReady = Promise.resolve()
        .then(() => loadCaptcha())
        .then(
          () => null,
          (error) => (error instanceof Error ? error : new Error("验证码组件加载失败")),
        );
      try {
        const statusRequest = sharedSigninStatus(accountStatus() !== "已登录");
        const statusStartedAt = statusRequest.startedAt;
        const result = await statusRequest;
        if (
          flowGeneration !== rushFlowGeneration ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (blogsClubOnlyEnabled() && !isBlogsClubPage())
        ) {
          return;
        }
        setAccountStatus("已登录");
        if (signinSuccessSerial !== successSerialAtStart && lastSigninSuccessAt >= targetMidnight) {
          // 等待状态期间已有当前日成功提交，不能再弹出或提交这轮验证码。
          rushSubmitAt = 0;
          rushTargetMidnight = 0;
          return;
        }
        // 零点前查到的是前一天状态，不能据此跳过新一天的签到。
        if (result.signin && statusStartedAt >= targetMidnight) {
          rushSubmitAt = 0;
          rushTargetMidnight = 0;
          return;
        }
        const captchaError = await captchaReady;
        if (captchaError) throw captchaError;
        if (
          flowGeneration !== rushFlowGeneration ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (blogsClubOnlyEnabled() && !isBlogsClubPage())
        ) {
          return;
        }
        rushCaptchaGeneration = flowGeneration;
        rushCaptchaPending = true;
        notify("抢签到验证码已打开，请在零点前完成验证。", "BlogsClub 签到");
        openCaptchaWindow(true, flowGeneration);
      } catch (error) {
        if (
          flowGeneration !== rushFlowGeneration ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (blogsClubOnlyEnabled() && !isBlogsClubPage())
        )
          return;
        rushSubmitAt = 0;
        rushTargetMidnight = 0;
        notify(`抢签到准备失败：${error.message || "检查失败"}`);
      }
    })().finally(() => {
      // 旧 Promise 收尾时不能清空新一轮的准备状态。
      if (rushPreparing === preparing) {
        rushPreparing = null;
        rushPreparingGeneration = 0;
        rushPreparingTargetMidnight = 0;
      }
    });
    rushPreparing = preparing;
    rushPreparingGeneration = flowGeneration;
    rushPreparingTargetMidnight = targetMidnight;
    return rushPreparing;
  }

  /**
   * 安排下一次零点前的抢签到准备。
   *
   * @returns {Promise<void>} 调度完成。
   */
  async function scheduleRushCheck() {
    // 排程代号只隔离校准回调；次日重排不改变 flow 代号，避免截断当日并发重试。
    const scheduleGeneration = ++rushScheduleGeneration;
    const flowGeneration = rushFlowGeneration;
    if (rushTimer !== null) clearTimeout(rushTimer);
    rushTimer = null;
    if (!rushModeEnabled() || (blogsClubOnlyEnabled() && !isBlogsClubPage())) {
      return;
    }
    await calibrateServerClock();
    if (
      scheduleGeneration !== rushScheduleGeneration ||
      flowGeneration !== rushFlowGeneration ||
      !rushModeEnabled() ||
      (blogsClubOnlyEnabled() && !isBlogsClubPage())
    ) {
      return;
    }
    const targetMidnight = nextServerMidnight();
    const submitAt = targetMidnight + rushSubmitDelayMs();
    const prepareAt = targetMidnight - rushLeadSeconds() * 1000;
    rushTimer = setTimeout(
      () => {
        if (
          scheduleGeneration !== rushScheduleGeneration ||
          flowGeneration !== rushFlowGeneration ||
          !rushModeEnabled() ||
          (blogsClubOnlyEnabled() && !isBlogsClubPage())
        )
          return;
        rushTimer = null;
        prepareRushCaptcha(submitAt, targetMidnight, flowGeneration);
        // 等本次零点过去后再计算下一天，避免在准备点反复创建 0ms 定时器。
        rushTimer = setTimeout(
          () => {
            if (scheduleGeneration !== rushScheduleGeneration || flowGeneration !== rushFlowGeneration) return;
            rushTimer = null;
            scheduleRushCheck();
          },
          Math.max(1, submitAt + 100 - serverNow()),
        );
      },
      Math.max(0, prepareAt - serverNow()),
    );
  }

  /**
   * 根据抢签到模式决定立即开始提交或等到服务端零点后开始提交。
   *
   * @param {object} validation Geetest 验证结果。
   * @returns {void}
   */
  function handleCaptchaSuccess(validation) {
    if (!validation) return;
    const flowGeneration = rushCaptchaGeneration;
    if (flowGeneration === null) {
      sign(validation);
      return;
    }
    // 已取消、已换日或已排队的旧验证码回调不能降级为普通签到。
    if (
      flowGeneration !== rushFlowGeneration ||
      !rushCaptchaPending ||
      rushSubmitState !== null ||
      rushSubmitTimer !== null ||
      !rushModeEnabled() ||
      (blogsClubOnlyEnabled() && !isBlogsClubPage())
    )
      return;
    const submitAt = rushSubmitAt;
    const targetMidnight = rushTargetMidnight;
    if (!submitAt || !targetMidnight) return;
    rushCaptchaPending = false;
    if (serverNow() >= submitAt) {
      rushSubmitAt = 0;
      startRushSubmit(validation, flowGeneration, targetMidnight);
      return;
    }
    const delay = submitAt - serverNow();
    notify(`验证码已完成，将在服务端零点后提交（约 ${formatDuration(delay)}）。`, "BlogsClub 签到");
    const timer = setTimeout(() => {
      if (rushSubmitTimer === timer) rushSubmitTimer = null;
      if (
        flowGeneration !== rushFlowGeneration ||
        rushCaptchaGeneration !== flowGeneration ||
        rushTargetMidnight !== targetMidnight ||
        !rushModeEnabled() ||
        (blogsClubOnlyEnabled() && !isBlogsClubPage())
      )
        return;
      rushSubmitAt = 0;
      startRushSubmit(validation, flowGeneration, targetMidnight);
    }, delay);
    rushSubmitTimer = timer;
  }

  // 轮询、通知和验证码窗口调度。
  /**
   * 后台轮询每个自然日最多通知一次未签到状态；手动检查每次通知。
   *
   * @param {boolean} [force=false] 是否跳过每日通知限制。. Default is `false`
   * @param {number} elapsedMs 本次状态检查耗时。
   * @returns {void}
   */
  function notifyNeedSign(force = false, elapsedMs) {
    const date = new Date().toLocaleDateString("zh-CN");
    if (!force && GM_getValue(KEYS.notifiedDate, "") === date) return;
    GM_setValue(KEYS.notifiedDate, date);
    const duration = `（耗时 ${formatDuration(elapsedMs)}）`;
    notify(
      force || autoPopupEnabled()
        ? `今天还未签到，验证码即将弹出${duration}。`
        : `今天还未签到，请从油猴菜单执行“立即检查/签到”${duration}。`,
    );
  }

  /**
   * 检查登录和签到状态，按配置决定是否处理验证码。
   *
   * @param {boolean} [forceCaptcha=false] 是否强制打开验证码流程。. Default is `false`
   * @returns {Promise<object | void>} 本轮检查完成及结果。
   */
  function check(forceCaptcha = false) {
    if (blogsClubOnlyEnabled() && !isBlogsClubPage()) {
      if (forceCaptcha) {
        notify("请在 BlogsClub 页面执行“立即检查/签到”。");
      }
      return Promise.resolve();
    }
    if (checking) {
      return checking.then((state) => {
        if (forceCaptcha && state?.error) {
          notify(state.error.message || "检查失败");
        } else if (forceCaptcha && state?.result && !state.stale) {
          applyCheckResult(state.result, true, state.elapsedMs, state.statusStartedAt);
        }
        return state;
      });
    }
    const run = (async () => {
      const startedAt = performance.now();
      const successSerialAtStart = signinSuccessSerial;
      let statusStartedAt = serverNow();
      try {
        const statusRequest = sharedSigninStatus(accountStatus() !== "已登录");
        statusStartedAt = statusRequest.startedAt;
        const result = await statusRequest;
        const elapsedMs = performance.now() - startedAt;
        if (!result.signin && signinSuccessSerial !== successSerialAtStart && lastSigninSuccessAt >= statusStartedAt) {
          // 旧状态响应不能在已确认成功后重新打开验证码。
          return {
            result,
            elapsedMs,
            statusStartedAt,
            stale: true,
            error: null,
          };
        }
        applyCheckResult(result, forceCaptcha, elapsedMs, statusStartedAt);
        return { result, elapsedMs, statusStartedAt, error: null };
      } catch (error) {
        setAccountStatus(hasCredentials() ? "登录失败" : "未设置");
        if (forceCaptcha) notify(error.message || "检查失败");
        return {
          result: null,
          elapsedMs: performance.now() - startedAt,
          statusStartedAt,
          error,
        };
      }
    })();
    const settled = run.finally(() => {
      // 旧检查的 finally 不能清空新一轮检查引用。
      if (checking === settled) checking = null;
    });
    checking = settled;
    return settled;
  }

  /**
   * 处理一次签到状态结果。
   *
   * @param {object} result 接口响应。
   * @param {boolean} forceCaptcha 是否强制打开验证码流程。
   * @param {number} elapsedMs 检查耗时。
   * @param {number} statusStartedAt 状态请求开始时的服务端时间。
   * @returns {void}
   */
  function applyCheckResult(result, forceCaptcha, elapsedMs, statusStartedAt = serverNow()) {
    setAccountStatus("已登录");
    if (result.signin) {
      stopRushForKnownSignin(statusStartedAt);
      if (forceCaptcha) {
        notify(`今天已签到（耗时 ${formatDuration(elapsedMs)}）。`);
      }
      return;
    }
    notifyNeedSign(forceCaptcha, elapsedMs);
    if (forceCaptcha || autoPopupEnabled()) {
      openCaptchaWindow();
    }
  }

  /**
   * 在当前页面最多打开一个验证码窗口。
   *
   * @param {boolean} [rush=false] 是否由 rush 准备流程调用。. Default is `false`
   * @param {number | null} [flowGeneration=null] Rush 流程代号。. Default is `null`
   * @returns {void}
   */
  function openCaptchaWindow(rush = false, flowGeneration = null) {
    // rush 准备期间普通流程让位，避免两个异步回调争抢同一个验证码实例。
    const canOpen = rush
      ? flowGeneration === rushFlowGeneration && rushCaptchaGeneration === flowGeneration && rushCaptchaPending
      : rushPreparing === null && !rushCaptchaPending;
    if (rushSubmitTimer === null && rushSubmitState === null && canOpen && !hasVisibleCaptcha()) {
      if (!rush) rushCaptchaGeneration = null;
      openCaptcha();
    }
  }

  GM_registerMenuCommand("立即检查/签到", () => {
    notify("检查签到状态中……");
    return check(true);
  });
  registerIntervalMenu();
  registerAccountMenu();
  registerBlogsClubOnlyMenu();
  registerAutoPopupMenu();
  registerRushModeMenu();
  registerRushLeadMenu();
  registerRushSubmitDelayMenu();
  registerRushSubmitRetriesMenu();
  registerRushSubmitIntervalMenu();

  check();
  /**
   * 安排下一轮检查；每轮读取最新周期，配置修改无需重载脚本。
   *
   * @returns {void}
   */
  function scheduleChecks() {
    setTimeout(async () => {
      await check();
      scheduleChecks();
    }, intervalMs());
  }

  scheduleChecks();
  scheduleRushCheck();
}
