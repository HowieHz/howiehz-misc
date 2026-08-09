"use strict";

/** 用户脚本本地存储中的 BlogsClub 登录凭据；尚未配置时字段可以缺失。 */
interface Credentials {
  email?: string;
  password?: string;
}

/** 已通过本地配置检查、可用于一次登录请求的凭据。 */
interface LoginCredentials {
  email: string;
  password: string;
}

/** 按凭据身份复用的进行中登录流程。 */
interface LoginCandidate {
  credentials: LoginCredentials;
  promise: Promise<void>;
}

/** 登录验证码当前请求及其所属 Geetest 实例。 */
interface LoginCaptchaRequest {
  instance: CaptchaInstance | null;
  reject: (reason?: unknown) => void;
  isResolved: boolean;
  isShown: boolean;
  closeTimer: number | null;
}

/** 登录验证码产生的结果和请求身份，避免清理新一轮验证码。 */
interface LoginCaptchaResult {
  validation: Record<string, unknown>;
  request: LoginCaptchaRequest;
}

/** 发送 BlogsClub 请求所需的 GM_xmlhttpRequest 选项。 */
interface RequestOptions {
  method: string;
  url: string;
  data?: string;
  headers?: Record<string, string>;
  parseJson?: boolean;
  timeout?: number;
}

/** BlogsClub 接口共用的响应字段；具体接口只返回其中一部分。 */
interface ApiResponse {
  code?: number;
  msg?: string;
  data?: unknown;
  signin?: boolean;
}

/** 可供并发调用方复用的签到状态请求及其服务端起始时间。 */
type SharedStatusPromise = Promise<ApiResponse> & { startedAt: number };

if (window.top === window && !window.__BLOGSCLUB_AUTO_SIGNIN__) {
  window.__BLOGSCLUB_AUTO_SIGNIN__ = true;

  const API = "https://www.blogsclub.org"; // BlogsClub 接口和页面请求的根地址。
  const CAPTCHA_ID = "f70029ad5e8b031ff90bd54bce240f14"; // BlogsClub 登录和签到使用的 Geetest 验证码 ID。
  const DEFAULT_INTERVAL_MS = 1000; // 后台状态检查的默认周期：1 秒。
  const MIN_INTERVAL_MS = 1; // 检查周期允许的最小值：1 毫秒。
  const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 检查周期允许的最大值：24 小时。
  const DEFAULT_RUSH_LEAD_SECONDS = 5; // 默认在服务端零点前 5 秒打开验证码。
  const MIN_RUSH_LEAD_SECONDS = 1; // 验证码提前加载允许的最小值：1 秒。
  const MAX_RUSH_LEAD_SECONDS = 60; // 验证码提前加载允许的最大值：60 秒。
  const DEFAULT_RUSH_SUBMIT_DELAY_MS = 500; // 默认在服务端零点后 500 毫秒提交。
  const MIN_RUSH_SUBMIT_DELAY_MS = 0; // 提交延迟允许为 0，表示零点立即提交。
  const MAX_RUSH_SUBMIT_DELAY_MS = 60 * 1000; // 提交延迟允许的最大值：60 秒。
  const DEFAULT_RUSH_SUBMIT_RETRIES = 50; // 默认重试 50 次，不含首次提交。
  const MIN_RUSH_SUBMIT_RETRIES = 0; // 允许关闭重试，仅保留首次提交。
  const MAX_RUSH_SUBMIT_RETRIES = Number.MAX_SAFE_INTEGER; // 受 JavaScript 安全整数范围限制的最大重试次数。
  const DEFAULT_RUSH_SUBMIT_INTERVAL_MS = 200; // 默认两次抢签到提交之间间隔 200 毫秒。
  const MIN_RUSH_SUBMIT_INTERVAL_MS = 1; // 重试间隔允许的最小值：1 毫秒。
  const MAX_RUSH_SUBMIT_INTERVAL_MS = 60 * 1000; // 重试间隔允许的最大值：60 秒。
  // 持久化键名保持现有前缀，兼容已安装的旧版本脚本。
  const KEYS = {
    credentials: "blogsclub-auto-signin-credentials",
    accountStatus: "blogsclub-auto-signin-account-status",
    language: "blogsclub-auto-signin-language",
    interval: "blogsclub-auto-signin-interval-ms",
    blogsClubAutoCheckOnly: "blogsclub-auto-signin-blogsclub-only",
    autoPopup: "blogsclub-auto-signin-auto-popup",
    rushMode: "blogsclub-auto-signin-rush-mode",
    rushLeadSeconds: "blogsclub-auto-signin-rush-lead-seconds",
    rushSubmitDelayMs: "blogsclub-auto-signin-rush-submit-delay-ms",
    rushSubmitRetries: "blogsclub-auto-signin-rush-submit-retries",
    rushSubmitIntervalMs: "blogsclub-auto-signin-rush-submit-interval-ms",
    notifiedDate: "blogsclub-auto-signin-notified",
  };

  /** 脚本菜单和通知支持的界面语言。 */
  type Language = "en" | "zh-Hans" | "zh-Hant";

  // 菜单和通知使用的多语言文案表。
  const MESSAGES: Record<Language, Record<string, string>> = {
    en: {
      notificationTitle: "BlogsClub Check-in",
      configTitle: "BlogsClub settings",
      languageMenu: "Switch language",
      languagePrompt: "Choose a language:\n1 English\n2 简体中文\n3 繁體中文",
      invalidLanguage: "Please enter 1, 2, or 3.",
      languageChanged: "Language switched to {language}.",
      languageEnglish: "English",
      languageSimplifiedChinese: "简体中文",
      languageTraditionalChinese: "繁體中文",
      checkNowMenu: "Check now / check in",
      intervalMenu: "Check interval: {value} ms",
      accountMenu: "BlogsClub account: {status}",
      blogsClubAutoCheckOnlyMenu: "Automatic status checks only on BlogsClub pages: {state}",
      autoPopupMenu: "Auto CAPTCHA popup when check-in is available: {state}",
      rushModeMenu: "Rush Check-in mode: {state}",
      rushLeadMenu: "Rush Check-in CAPTCHA lead time: {value} seconds",
      rushSubmitDelayMenu: "Rush Check-in submission delay: {value} ms",
      rushSubmitRetriesMenu: "Rush Check-in submission retries: {value}",
      rushSubmitIntervalMenu: "Rush Check-in retry interval: {value} ms",
      enabled: "Enabled",
      disabled: "Disabled",
      statusNotConfigured: "Not configured",
      statusSaved: "Saved",
      statusLoggedIn: "Logged in",
      statusLoginFailed: "Login failed",
      accountEmailPrompt: "BlogsClub login email",
      accountPasswordPrompt: "BlogsClub login password",
      credentialsEmpty: "Email or password cannot be empty.",
      accountSaved: "Account saved.",
      loginSuccess: "Login succeeded.",
      intervalPrompt: "Check interval (milliseconds, {min}-{max})",
      invalidInterval: "Enter an integer from {min} to {max}.",
      intervalSaved: "Check interval set to {value} ms.",
      rushLeadPrompt: "Rush Check-in CAPTCHA lead time (seconds, {min}-{max})",
      invalidRushLead: "Enter an integer number of seconds from {min} to {max}.",
      rushLeadSaved: "Rush Check-in CAPTCHA lead time set to {value} seconds.",
      rushSubmitDelayPrompt: "Rush Check-in submission delay (milliseconds, {min}-{max})",
      invalidRushSubmitDelay: "Enter an integer number of milliseconds from {min} to {max}.",
      rushSubmitDelaySaved: "Rush Check-in submission delay set to {value} ms.",
      rushSubmitRetriesPrompt: "Rush Check-in submission retries (excluding the first submission, {min}-{max})",
      invalidRushSubmitRetries: "Enter an integer number of retries from {min} to {max}.",
      rushSubmitRetriesSaved: "Rush Check-in submission retries set to {value}.",
      rushSubmitIntervalPrompt: "Rush Check-in retry interval (milliseconds, {min}-{max})",
      invalidRushSubmitInterval: "Enter an integer number of milliseconds from {min} to {max}.",
      rushSubmitIntervalSaved: "Rush Check-in retry interval set to {value} ms.",
      autoPopupChanged: "Automatic CAPTCHA popup {state}.",
      blogsClubAutoCheckOnlyChanged: "BlogsClub-only automatic status checks {state}.",
      rushModeChanged: "Rush Check-in mode {state}.",
      requestNoResponse: "Not logged in or the endpoint returned no response.",
      responseFormatError: "The endpoint returned an invalid response.",
      checkFailed: "Check failed.",
      networkFailure: "Network request failed.",
      requestTimeout: "Request timed out.",
      accountRequired: "Set up a BlogsClub account first.",
      loginTokenMissing: "Login token not found.",
      loginFailed: "Login failed.",
      rankingUnavailable: "Today's check-in ranking is currently unavailable.",
      rankingPosition: "Today's check-in ranking: {rank}.",
      rankingOutsideTop: "Not in today's top 20.",
      loginSessionExpired: "The login session is no longer valid.",
      captchaNotLoaded: "The CAPTCHA component is not loaded.",
      captchaLoadFailed: "The CAPTCHA component failed to load.",
      signinSuccess: "Check-in succeeded",
      signinSuccessWithRanking: "{message}; {rank}",
      signinFailed: "Check-in failed.",
      rushCaptchaOpened: "The Rush Check-in CAPTCHA is open. Complete it before midnight.",
      rushPrepareFailed: "Rush Check-in preparation failed: {error}",
      captchaReady: "The CAPTCHA is complete. It will be submitted after server midnight (about {delay}).",
      notSignedAuto: "You have not checked in today. The CAPTCHA will open{duration}.",
      notSignedManual:
        "You have not checked in today. Use the userscript menu to choose “Check now / check in”{duration}.",
      checkingStatus: "Checking check-in status…",
      alreadySigned: "Already checked in today ({duration}).",
      elapsed: " ({duration})",
      durationSeconds: "{value} seconds",
      durationMilliseconds: "{value} ms",
    },
    "zh-Hans": {
      notificationTitle: "BlogsClub 签到",
      configTitle: "BlogsClub 配置",
      languageMenu: "切换语言",
      languagePrompt: "选择语言：\n1 English\n2 简体中文\n3 繁體中文",
      invalidLanguage: "请输入 1、2 或 3。",
      languageChanged: "语言已切换为{language}。",
      languageEnglish: "English",
      languageSimplifiedChinese: "简体中文",
      languageTraditionalChinese: "繁體中文",
      checkNowMenu: "立即检查/签到",
      intervalMenu: "检查周期：{value} 毫秒",
      accountMenu: "BlogsClub 账号：{status}",
      blogsClubAutoCheckOnlyMenu: "仅在 BlogsClub 页面自动检查状态：{state}",
      autoPopupMenu: "可签到时自动验证码弹窗：{state}",
      rushModeMenu: "零点抢签到模式：{state}",
      rushLeadMenu: "抢签到提前加载验证码：{value} 秒",
      rushSubmitDelayMenu: "抢签到提交延迟：{value} 毫秒",
      rushSubmitRetriesMenu: "抢签到提交重试次数：{value} 次",
      rushSubmitIntervalMenu: "抢签到提交重试间隔：{value} 毫秒",
      enabled: "启用",
      disabled: "关闭",
      statusNotConfigured: "未设置",
      statusSaved: "已保存",
      statusLoggedIn: "已登录",
      statusLoginFailed: "登录失败",
      accountEmailPrompt: "BlogsClub 登录邮箱",
      accountPasswordPrompt: "BlogsClub 登录密码",
      credentialsEmpty: "邮箱或密码不能为空。",
      accountSaved: "账号已保存。",
      loginSuccess: "登录成功。",
      intervalPrompt: "检查周期（毫秒，{min}～{max}）",
      invalidInterval: "请输入 {min}～{max} 的整数。",
      intervalSaved: "检查周期已设置为 {value} 毫秒。",
      rushLeadPrompt: "抢签到提前加载验证码时间（秒，{min}～{max}）",
      invalidRushLead: "请输入 {min}～{max} 的整数秒数。",
      rushLeadSaved: "抢签到提前加载验证码时间已设置为 {value} 秒。",
      rushSubmitDelayPrompt: "抢签到提交延迟（毫秒，{min}～{max}）",
      invalidRushSubmitDelay: "请输入 {min}～{max} 的整数毫秒数。",
      rushSubmitDelaySaved: "抢签到提交延迟已设置为 {value} 毫秒。",
      rushSubmitRetriesPrompt: "抢签到提交重试次数（不含首次提交，{min}～{max}）",
      invalidRushSubmitRetries: "请输入 {min}～{max} 的整数次数。",
      rushSubmitRetriesSaved: "抢签到提交重试次数已设置为 {value} 次。",
      rushSubmitIntervalPrompt: "抢签到提交重试间隔（毫秒，{min}～{max}）",
      invalidRushSubmitInterval: "请输入 {min}～{max} 的整数毫秒数。",
      rushSubmitIntervalSaved: "抢签到提交重试间隔已设置为 {value} 毫秒。",
      autoPopupChanged: `自动验证码弹窗已{state}。`,
      blogsClubAutoCheckOnlyChanged: `仅在 BlogsClub 页面自动检查状态已{state}。`,
      rushModeChanged: `零点抢签到模式已{state}。`,
      requestNoResponse: "未登录或接口无响应",
      responseFormatError: "接口返回格式异常",
      checkFailed: "检查失败",
      networkFailure: "网络请求失败",
      requestTimeout: "请求超时",
      accountRequired: "请先设置 BlogsClub 账号",
      loginTokenMissing: "未找到登录令牌",
      loginFailed: "登录失败",
      rankingUnavailable: "今日签到排名暂不可用",
      rankingPosition: "今日签到排名第 {rank} 名",
      rankingOutsideTop: "今日签到未进入前 20 名",
      loginSessionExpired: "登录状态失效",
      captchaNotLoaded: "验证码组件未加载",
      captchaLoadFailed: "验证码组件加载失败",
      signinSuccess: "签到成功",
      signinSuccessWithRanking: "{message},{rank}",
      signinFailed: "签到失败",
      rushCaptchaOpened: "抢签到验证码已打开，请在零点前完成验证。",
      rushPrepareFailed: "抢签到准备失败：{error}",
      captchaReady: "验证码已完成，将在服务端零点后提交（约 {delay}）。",
      notSignedAuto: "今天还未签到，验证码即将弹出{duration}。",
      notSignedManual: "今天还未签到，请从油猴菜单执行“立即检查/签到”{duration}。",
      checkingStatus: "检查签到状态中……",
      alreadySigned: "今天已签到（耗时 {duration}）。",
      elapsed: "（耗时 {duration}）",
      durationSeconds: "{value} 秒",
      durationMilliseconds: "{value} 毫秒",
    },
    "zh-Hant": {
      notificationTitle: "BlogsClub 簽到",
      configTitle: "BlogsClub 設定",
      languageMenu: "切換語言",
      languagePrompt: "選擇語言：\n1 English\n2 简体中文\n3 繁體中文",
      invalidLanguage: "請輸入 1、2 或 3。",
      languageChanged: "語言已切換為{language}。",
      languageEnglish: "English",
      languageSimplifiedChinese: "简体中文",
      languageTraditionalChinese: "繁體中文",
      checkNowMenu: "立即檢查/簽到",
      intervalMenu: "檢查週期：{value} 毫秒",
      accountMenu: "BlogsClub 帳號：{status}",
      blogsClubAutoCheckOnlyMenu: "僅在 BlogsClub 頁面自動檢查狀態：{state}",
      autoPopupMenu: "可簽到時自動彈出驗證碼：{state}",
      rushModeMenu: "零點搶簽到模式：{state}",
      rushLeadMenu: "搶簽到提前載入驗證碼：{value} 秒",
      rushSubmitDelayMenu: "搶簽到提交延遲：{value} 毫秒",
      rushSubmitRetriesMenu: "搶簽到提交重試次數：{value} 次",
      rushSubmitIntervalMenu: "搶簽到提交重試間隔：{value} 毫秒",
      enabled: "啟用",
      disabled: "關閉",
      statusNotConfigured: "未設定",
      statusSaved: "已儲存",
      statusLoggedIn: "已登入",
      statusLoginFailed: "登入失敗",
      accountEmailPrompt: "BlogsClub 登入電子郵件",
      accountPasswordPrompt: "BlogsClub 登入密碼",
      credentialsEmpty: "電子郵件或密碼不能為空。",
      accountSaved: "帳號已儲存。",
      loginSuccess: "登入成功。",
      intervalPrompt: "檢查週期（毫秒，{min}～{max}）",
      invalidInterval: "請輸入 {min}～{max} 的整數。",
      intervalSaved: "檢查週期已設定為 {value} 毫秒。",
      rushLeadPrompt: "搶簽到提前載入驗證碼時間（秒，{min}～{max}）",
      invalidRushLead: "請輸入 {min}～{max} 的整數秒數。",
      rushLeadSaved: "搶簽到提前載入驗證碼時間已設定為 {value} 秒。",
      rushSubmitDelayPrompt: "搶簽到提交延遲（毫秒，{min}～{max}）",
      invalidRushSubmitDelay: "請輸入 {min}～{max} 的整數毫秒數。",
      rushSubmitDelaySaved: "搶簽到提交延遲已設定為 {value} 毫秒。",
      rushSubmitRetriesPrompt: "搶簽到提交重試次數（不含首次提交，{min}～{max}）",
      invalidRushSubmitRetries: "請輸入 {min}～{max} 的整數次數。",
      rushSubmitRetriesSaved: "搶簽到提交重試次數已設定為 {value} 次。",
      rushSubmitIntervalPrompt: "搶簽到提交重試間隔（毫秒，{min}～{max}）",
      invalidRushSubmitInterval: "請輸入 {min}～{max} 的整數毫秒數。",
      rushSubmitIntervalSaved: "搶簽到提交重試間隔已設定為 {value} 毫秒。",
      autoPopupChanged: `自動彈出驗證碼已{state}。`,
      blogsClubAutoCheckOnlyChanged: `僅在 BlogsClub 頁面自動檢查狀態已{state}。`,
      rushModeChanged: `零點搶簽到模式已{state}。`,
      requestNoResponse: "未登入或介面無回應",
      responseFormatError: "介面回傳格式異常",
      checkFailed: "檢查失敗",
      networkFailure: "網路請求失敗",
      requestTimeout: "請求逾時",
      accountRequired: "請先設定 BlogsClub 帳號",
      loginTokenMissing: "找不到登入令牌",
      loginFailed: "登入失敗",
      rankingUnavailable: "今日簽到排名暫時無法取得",
      rankingPosition: "今日簽到排名第 {rank} 名",
      rankingOutsideTop: "今日簽到未進入前 20 名",
      loginSessionExpired: "登入工作階段已失效",
      captchaNotLoaded: "驗證碼元件未載入",
      captchaLoadFailed: "驗證碼元件載入失敗",
      signinSuccess: "簽到成功",
      signinSuccessWithRanking: "{message},{rank}",
      signinFailed: "簽到失敗",
      rushCaptchaOpened: "搶簽到驗證碼已開啟，請在零點前完成驗證。",
      rushPrepareFailed: "搶簽到準備失敗：{error}",
      captchaReady: "驗證碼已完成，將在伺服器零點後提交（約 {delay}）。",
      notSignedAuto: "今天尚未簽到，驗證碼即將彈出{duration}。",
      notSignedManual: "今天尚未簽到，請從油猴選單執行「立即檢查/簽到」{duration}。",
      checkingStatus: "正在檢查簽到狀態……",
      alreadySigned: "今天已簽到（耗時 {duration}）。",
      elapsed: "（耗時 {duration}）",
      durationSeconds: "{value} 秒",
      durationMilliseconds: "{value} 毫秒",
    },
  };

  function isLanguage(value: unknown): value is Language {
    return value === "en" || value === "zh-Hans" || value === "zh-Hant";
  }

  function detectLanguage(): Language {
    const preferences = [...(navigator.languages || []), navigator.language];
    for (const preference of preferences) {
      const locale = preference.toLowerCase().replaceAll("_", "-");
      if (
        locale.startsWith("zh-tw") ||
        locale.startsWith("zh-hant") ||
        locale.startsWith("zh-hk") ||
        locale.startsWith("zh-mo")
      ) {
        return "zh-Hant";
      }
      if (locale.startsWith("zh-")) return "zh-Hans";
      if (locale === "zh") return "zh-Hans";
      if (locale.startsWith("en")) return "en";
    }
    return "en";
  }

  function currentLanguage(): Language {
    const saved = GM_getValue<unknown>(KEYS.language, null);
    if (isLanguage(saved)) return saved;
    const detected = detectLanguage();
    GM_setValue(KEYS.language, detected);
    return detected;
  }

  function t(key: string, values: Record<string, string | number> = {}) {
    return (MESSAGES[currentLanguage()][key] || key).replace(/\{(\w+)\}/g, (_, name) =>
      String(values[name] ?? `{${name}}`),
    );
  }

  function languageName(language: Language) {
    return t(
      language === "en"
        ? "languageEnglish"
        : language === "zh-Hans"
          ? "languageSimplifiedChinese"
          : "languageTraditionalChinese",
    );
  }

  function languageIndex(language: Language) {
    return language === "en" ? 1 : language === "zh-Hans" ? 2 : 3;
  }

  function captchaLanguage() {
    const language = currentLanguage();
    return language === "en" ? "eng" : language === "zh-Hant" ? "cht" : "zho";
  }

  // 本地配置与油猴菜单。
  // 保存已注册菜单 ID，配置刷新时由 registerMenu 负责注销旧菜单。
  const menuIds = new Map<string, ReturnType<typeof GM_registerMenuCommand>>();

  /**
   * 显示油猴通知；没有通知 API 时退回控制台。
   *
   * @param {string} text 通知正文。
   * @param {string} [title] 通知标题。
   * @returns {void}
   */
  function notify(text, title = t("notificationTitle")) {
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
      return t("durationSeconds", { value: Number((milliseconds / 1000).toFixed(2)) });
    }
    return t("durationMilliseconds", { value: Math.round(milliseconds) });
  }

  /**
   * 注册或替换一个油猴菜单项。
   *
   * @param {string} name 菜单的稳定名称。
   * @param {string} label 菜单显示文本。
   * @param {Function} handler 点击菜单后的处理函数。
   * @returns {void}
   */
  function registerMenu(name, label, handler) {
    const currentId = menuIds.get(name);
    if (currentId !== undefined && typeof GM_unregisterMenuCommand === "function") {
      GM_unregisterMenuCommand(currentId);
    }
    menuIds.set(name, GM_registerMenuCommand(label, handler));
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
   * 通过菜单配置 BlogsClub 账号，验证凭据后触发一次检查。
   *
   * @returns {void}
   */
  function configureAccount() {
    const current = credentials();
    const email = prompt(t("accountEmailPrompt"), current.email || "");
    if (email === null) return;
    const password = prompt(t("accountPasswordPrompt"), "");
    if (password === null) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) {
      notify(t("credentialsEmpty"), t("configTitle"));
      return;
    }
    GM_setValue(KEYS.credentials, { email: email.trim(), password });
    GM_setValue(KEYS.accountStatus, "已保存");
    registerMenus();
    notify(t("accountSaved"), t("configTitle"));
    if (rushModeEnabled()) {
      // 凭据变更后，旧验证码和旧会话请求不能继续提交到新账号流程。
      restartRushCheck();
    }
    void login()
      .then(() => {
        setAccountStatus("已登录");
        notify(t("loginSuccess"), t("configTitle"));
        check();
      })
      .catch((error) => {
        setAccountStatus("登录失败");
        notify(error?.message || t("loginFailed"), t("configTitle"));
      });
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
    const input = prompt(t("intervalPrompt", { min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS }), String(intervalMs()));
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) {
      notify(t("invalidInterval", { min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS }), t("configTitle"));
      return;
    }
    GM_setValue(KEYS.interval, value);
    registerMenus();
    notify(t("intervalSaved", { value }), t("configTitle"));
    check();
  }

  /**
   * 判断未签到时是否自动打开验证码。
   *
   * @returns {boolean} 是否启用自动弹窗。
   */
  function autoPopupEnabled() {
    return GM_getValue<boolean>(KEYS.autoPopup, true) === true;
  }

  /**
   * 判断是否启用零点抢签到模式。
   *
   * @returns {boolean} 是否启用抢签到模式。
   */
  function rushModeEnabled() {
    return GM_getValue<boolean>(KEYS.rushMode, true) === true;
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
   * 判断是否只在 BlogsClub 页面自动检查状态。
   *
   * @returns {boolean} 是否限制自动检查所在页面。
   */
  function isBlogsClubAutoCheckOnlyEnabled() {
    return GM_getValue(KEYS.blogsClubAutoCheckOnly, true) === true;
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

  function accountStatusLabel() {
    switch (accountStatus()) {
      case "已保存":
        return t("statusSaved");
      case "已登录":
        return t("statusLoggedIn");
      case "登录失败":
        return t("statusLoginFailed");
      default:
        return t("statusNotConfigured");
    }
  }

  /**
   * 注册显示当前检查周期的动态菜单。
   *
   * @returns {void}
   */
  function registerIntervalMenu() {
    registerMenu("interval", t("intervalMenu", { value: intervalMs() }), configureInterval);
  }

  function registerCheckMenu() {
    registerMenu("check", t("checkNowMenu"), () => {
      notify(t("checkingStatus"));
      return check({ isManual: true, shouldForceCaptcha: true });
    });
  }

  /**
   * 注册显示账号状态的动态菜单。
   *
   * @returns {void}
   */
  function registerAccountMenu() {
    registerMenu("account", t("accountMenu", { status: accountStatusLabel() }), configureAccount);
  }

  /**
   * 注册仅在 BlogsClub 页面自动检查状态的开关菜单。
   *
   * @returns {void}
   */
  function registerBlogsClubAutoCheckOnlyMenu() {
    registerMenu(
      "blogsClubAutoCheckOnly",
      t("blogsClubAutoCheckOnlyMenu", { state: t(isBlogsClubAutoCheckOnlyEnabled() ? "enabled" : "disabled") }),
      toggleBlogsClubAutoCheckOnly,
    );
  }

  /**
   * 注册自动验证码弹窗开关菜单。
   *
   * @returns {void}
   */
  function registerAutoPopupMenu() {
    registerMenu(
      "autoPopup",
      t("autoPopupMenu", { state: t(autoPopupEnabled() ? "enabled" : "disabled") }),
      toggleAutoPopup,
    );
  }

  /**
   * 注册零点抢签到模式菜单。
   *
   * @returns {void}
   */
  function registerRushModeMenu() {
    registerMenu(
      "rushMode",
      t("rushModeMenu", { state: t(rushModeEnabled() ? "enabled" : "disabled") }),
      toggleRushMode,
    );
  }

  /**
   * 注册零点抢签到提前加载验证码时间菜单。
   *
   * @returns {void}
   */
  function registerRushLeadMenu() {
    registerMenu("rushLead", t("rushLeadMenu", { value: rushLeadSeconds() }), configureRushLead);
  }

  /**
   * 通过菜单配置抢签到提前加载验证码时间，单位为秒。
   *
   * @returns {void}
   */
  function configureRushLead() {
    const input = prompt(
      t("rushLeadPrompt", { min: MIN_RUSH_LEAD_SECONDS, max: MAX_RUSH_LEAD_SECONDS }),
      String(rushLeadSeconds()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_LEAD_SECONDS || value > MAX_RUSH_LEAD_SECONDS) {
      notify(t("invalidRushLead", { min: MIN_RUSH_LEAD_SECONDS, max: MAX_RUSH_LEAD_SECONDS }), t("configTitle"));
      return;
    }
    GM_setValue(KEYS.rushLeadSeconds, value);
    registerMenus();
    notify(t("rushLeadSaved", { value }), t("configTitle"));
    if (rushModeEnabled()) restartRushCheck();
  }

  /**
   * 注册零点抢签到提交延迟菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitDelayMenu() {
    registerMenu("rushSubmitDelay", t("rushSubmitDelayMenu", { value: rushSubmitDelayMs() }), configureRushSubmitDelay);
  }

  /**
   * 通过菜单配置零点抢签到提交延迟，单位为毫秒。
   *
   * @returns {void}
   */
  function configureRushSubmitDelay() {
    const input = prompt(
      t("rushSubmitDelayPrompt", { min: MIN_RUSH_SUBMIT_DELAY_MS, max: MAX_RUSH_SUBMIT_DELAY_MS }),
      String(rushSubmitDelayMs()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_DELAY_MS || value > MAX_RUSH_SUBMIT_DELAY_MS) {
      notify(
        t("invalidRushSubmitDelay", { min: MIN_RUSH_SUBMIT_DELAY_MS, max: MAX_RUSH_SUBMIT_DELAY_MS }),
        t("configTitle"),
      );
      return;
    }
    GM_setValue(KEYS.rushSubmitDelayMs, value);
    registerMenus();
    notify(t("rushSubmitDelaySaved", { value }), t("configTitle"));
    if (rushModeEnabled()) restartRushCheck();
  }

  /**
   * 注册零点抢签到提交重试次数菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitRetriesMenu() {
    registerMenu(
      "rushSubmitRetries",
      t("rushSubmitRetriesMenu", { value: rushSubmitRetries() }),
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
      t("rushSubmitRetriesPrompt", { min: MIN_RUSH_SUBMIT_RETRIES, max: MAX_RUSH_SUBMIT_RETRIES }),
      String(rushSubmitRetries()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_RETRIES || value > MAX_RUSH_SUBMIT_RETRIES) {
      notify(
        t("invalidRushSubmitRetries", { min: MIN_RUSH_SUBMIT_RETRIES, max: MAX_RUSH_SUBMIT_RETRIES }),
        t("configTitle"),
      );
      return;
    }
    GM_setValue(KEYS.rushSubmitRetries, value);
    registerMenus();
    notify(t("rushSubmitRetriesSaved", { value }), t("configTitle"));
  }

  /**
   * 注册零点抢签到提交重试间隔菜单。
   *
   * @returns {void}
   */
  function registerRushSubmitIntervalMenu() {
    registerMenu(
      "rushSubmitInterval",
      t("rushSubmitIntervalMenu", { value: rushSubmitIntervalMs() }),
      configureRushSubmitInterval,
    );
  }

  function registerLanguageMenu() {
    registerMenu("language", `🌐 ${t("languageMenu")}`, configureLanguage);
  }

  function registerMenus() {
    registerCheckMenu();
    registerIntervalMenu();
    registerAccountMenu();
    registerBlogsClubAutoCheckOnlyMenu();
    registerAutoPopupMenu();
    registerRushModeMenu();
    registerRushLeadMenu();
    registerRushSubmitDelayMenu();
    registerRushSubmitRetriesMenu();
    registerRushSubmitIntervalMenu();
    registerLanguageMenu();
  }

  function configureLanguage() {
    const input = prompt(t("languagePrompt"), String(languageIndex(currentLanguage())));
    if (input === null) return;
    const value = Number(input.trim());
    const selected: Language | null = value === 1 ? "en" : value === 2 ? "zh-Hans" : value === 3 ? "zh-Hant" : null;
    if (!selected) {
      notify(t("invalidLanguage"), t("configTitle"));
      return;
    }
    GM_setValue(KEYS.language, selected);
    const hadVisibleCaptcha = hasVisibleCaptcha();
    captchaGeneration += 1;
    captcha?.reset?.();
    captcha = null;
    registerMenus();
    notify(t("languageChanged", { language: languageName(selected) }), t("configTitle"));
    if (hadVisibleCaptcha) {
      openCaptchaWindow(isRushCaptchaPending, rushCaptchaGeneration);
    }
  }

  /**
   * 通过菜单配置零点抢签到提交重试间隔，单位为毫秒。
   *
   * @returns {void}
   */
  function configureRushSubmitInterval() {
    const input = prompt(
      t("rushSubmitIntervalPrompt", { min: MIN_RUSH_SUBMIT_INTERVAL_MS, max: MAX_RUSH_SUBMIT_INTERVAL_MS }),
      String(rushSubmitIntervalMs()),
    );
    if (input === null) return;
    const value = Number(input.trim());
    if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_INTERVAL_MS || value > MAX_RUSH_SUBMIT_INTERVAL_MS) {
      notify(
        t("invalidRushSubmitInterval", { min: MIN_RUSH_SUBMIT_INTERVAL_MS, max: MAX_RUSH_SUBMIT_INTERVAL_MS }),
        t("configTitle"),
      );
      return;
    }
    GM_setValue(KEYS.rushSubmitIntervalMs, value);
    registerMenus();
    notify(t("rushSubmitIntervalSaved", { value }), t("configTitle"));
  }

  /**
   * 切换未签到时的验证码自动弹窗。
   *
   * @returns {void}
   */
  function toggleAutoPopup() {
    const isEnabled = !autoPopupEnabled();
    GM_setValue(KEYS.autoPopup, isEnabled);
    registerMenus();
    notify(t("autoPopupChanged", { state: isEnabled ? t("enabled") : t("disabled") }), t("configTitle"));
    if (isEnabled) check({ shouldForceCaptcha: true });
  }

  /**
   * 切换是否仅在 BlogsClub 页面自动检查状态。
   *
   * @returns {void}
   */
  function toggleBlogsClubAutoCheckOnly() {
    const isEnabled = !isBlogsClubAutoCheckOnlyEnabled();
    GM_setValue(KEYS.blogsClubAutoCheckOnly, isEnabled);
    registerMenus();
    notify(t("blogsClubAutoCheckOnlyChanged", { state: isEnabled ? t("enabled") : t("disabled") }), t("configTitle"));
    if (rushModeEnabled()) {
      // 页面范围改变后，旧 rush 流程不能继续按过期的页面许可提交。
      if (isEnabled && !isBlogsClubPage()) {
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
    registerMenus();
    notify(t("rushModeChanged", { state: enabled ? t("enabled") : t("disabled") }), t("configTitle"));
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
    registerMenus();
  }

  // 网络请求与 BlogsClub 接口。
  let loginCandidate: LoginCandidate | null = null;
  let loginPagePromise = null;
  let signinStatusPromise = null;
  let isSigninStatusLoginForced = false;
  let serverClockOffsetMs = null;

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
            reject(new Error(t("requestNoResponse")));
            return;
          }
          if (!parseJson) {
            resolve(text);
            return;
          }
          try {
            resolve(JSON.parse(text) as ApiResponse);
          } catch {
            reject(new Error(t("responseFormatError")));
          }
        },
        onerror: () => reject(new Error(t("networkFailure"))),
        ontimeout: () => reject(new Error(t("requestTimeout"))),
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
  function login() {
    const saved = credentials();
    if (!saved.email || !saved.password) return Promise.reject(new Error(t("accountRequired")));
    const currentCredentials = { email: saved.email, password: saved.password };
    if (
      loginCandidate &&
      loginCandidate.credentials.email === currentCredentials.email &&
      loginCandidate.credentials.password === currentCredentials.password
    ) {
      return loginCandidate.promise;
    }
    const promise = performLogin(currentCredentials);
    const shared = promise.finally(() => {
      if (loginCandidate?.promise === shared) loginCandidate = null;
    });
    loginCandidate = { credentials: currentCredentials, promise: shared };
    return shared;
  }

  /**
   * 使用固定的一组凭据完成一次 BlogsClub 登录。
   *
   * @param {object} loginCredentials 本次登录使用的完整凭据。
   * @returns {Promise<void>} 登录成功或抛出错误。
   */
  async function performLogin(loginCredentials: LoginCredentials) {
    const { email, password } = loginCredentials;

    const page = await loginPage();
    const token = page.match(/window\.bcToken\s*=\s*["']([^"']+)["']/)?.[1];
    if (!token) throw new Error(t("loginTokenMissing"));
    const captchaResult = await loginCaptchaValidation();

    try {
      const currentCredentials = credentials();
      if (currentCredentials.email !== email || currentCredentials.password !== password) {
        throw new Error(t("loginFailed"));
      }
      const result = await request({
        method: "POST",
        url: `${API}/index.php/getLogin`,
        data: form({
          type: "password",
          email,
          password,
          token,
          verify_token: JSON.stringify({ ...captchaResult.validation, captcha_id: CAPTCHA_ID }),
        }),
      });
      if (result.code !== 1) throw new Error(result.msg || t("loginFailed"));
      const latestCredentials = credentials();
      if (latestCredentials.email !== email || latestCredentials.password !== password) {
        throw new Error(t("loginFailed"));
      }
    } finally {
      resetLoginCaptcha(captchaResult.request);
    }
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
      if (result.code !== 1) return t("rankingUnavailable");
      const ranking = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
      const blogId = page.match(/id=["']personPage["'][^>]*\/blog\/(\d+)\.html/i)?.[1];
      if (!Array.isArray(ranking) || !blogId) return t("rankingUnavailable");
      const index = ranking.findIndex((user) => String(user.blog_id) === blogId);
      return index >= 0 ? t("rankingPosition", { rank: index + 1 }) : t("rankingOutsideTop");
    } catch {
      return t("rankingUnavailable");
    }
  }

  /**
   * 查询签到状态；必要时先用已保存凭据登录。
   *
   * @param {boolean} [shouldForceLogin=false] 是否跳过现有会话并重新登录。. Default is `false`
   * @returns {Promise<object>} 包含 signin 字段的接口响应。
   */
  async function signinStatus(shouldForceLogin = false) {
    let result;
    if (!shouldForceLogin) {
      try {
        result = await profile("signinStatus");
        if (result.code === 1) return result;
      } catch {
        // Retry with saved credentials below.
      }
    }
    await login();
    result = await profile("signinStatus");
    if (result.code !== 1) throw new Error(result.msg || t("loginSessionExpired"));
    return result;
  }

  /**
   * 共享进行中的签到状态流程；强制登录请求不复用普通状态请求。
   *
   * @param {boolean} [shouldForceLogin=false] 是否跳过现有会话并重新登录。. Default is `false`
   * @returns {Promise<object>} 包含 signin 字段的接口响应。
   */
  function sharedSigninStatus(shouldForceLogin = false) {
    if (signinStatusPromise && (!shouldForceLogin || isSigninStatusLoginForced)) {
      return signinStatusPromise;
    }
    const startedAt = serverNow();
    const promise = signinStatus(shouldForceLogin);
    const shared = promise.finally(() => {
      // 较早请求收尾时不能清空后来替代它的共享请求。
      if (signinStatusPromise === shared) {
        signinStatusPromise = null;
        isSigninStatusLoginForced = false;
      }
    }) as SharedStatusPromise;
    // 共享调用方必须使用最初请求的时间，不能用各自 await 前的时间覆盖它。
    shared.startedAt = startedAt;
    signinStatusPromise = shared;
    isSigninStatusLoginForced = shouldForceLogin;
    return shared;
  }

  // Geetest 加载和人工验证。
  let captcha = null;
  let captchaGeneration = 0;
  let captchaLoadPromise = null;
  let activeLoginCaptcha: LoginCaptchaRequest | null = null;
  let isCaptchaOpening = false;
  let isSigning = false;
  let signinSuccessSerial = 0;
  let lastSigninSuccessAt = 0;

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
    if (captchaLoadPromise) return captchaLoadPromise;
    captchaLoadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://static.geetest.com/v4/gt4.js";
      script.onload = () =>
        setTimeout(() => {
          if (geetestInit()) {
            resolve();
          } else {
            reject(new Error(t("captchaNotLoaded")));
          }
        }, 0);
      script.onerror = () => reject(new Error(t("captchaLoadFailed")));
      (document.head || document.documentElement).appendChild(script);
    }).finally(() => {
      captchaLoadPromise = null;
    });
    return captchaLoadPromise;
  }

  /**
   * 获取一次用于 BlogsClub 登录的人工 Geetest 结果。
   *
   * @returns {Promise<object>} Geetest v4 验证结果及其请求身份。
   */
  function loginCaptchaValidation() {
    cancelLoginCaptcha();
    captchaGeneration += 1;
    captcha?.reset?.();
    captcha = null;
    return loadCaptcha().then(() => {
      const init = geetestInit();
      if (!init) throw new Error(t("captchaNotLoaded"));
      let request: LoginCaptchaRequest | null = null;
      const resultPromise = new Promise<LoginCaptchaResult>((resolve, reject) => {
        request = { instance: null, reject, isResolved: false, isShown: false, closeTimer: null };
        activeLoginCaptcha = request;
        init({ captchaId: CAPTCHA_ID, product: "bind", language: captchaLanguage(), riskType: "slide" }, (instance) => {
          if (!request || activeLoginCaptcha !== request) {
            instance.reset();
            return;
          }
          request.instance = instance;
          instance.onReady(() => {
            if (activeLoginCaptcha === request) {
              request.isShown = true;
              instance.showCaptcha();
            }
          });
          instance.onClose?.(() => reject(new Error(t("loginFailed"))));
          instance.onError((error) => reject(error instanceof Error ? error : new Error(t("captchaLoadFailed"))));
          instance.onSuccess(() => {
            const validation = instance.getValidate();
            if (!validation) {
              reject(new Error(t("captchaLoadFailed")));
              return;
            }
            request.isResolved = true;
            resolve({ validation, request });
          });
          request.closeTimer = window.setInterval(() => {
            if (activeLoginCaptcha === request && request.isShown && !request.isResolved && !hasVisibleCaptcha()) {
              reject(new Error(t("loginFailed")));
            }
          }, 250);
        });
      });
      return resultPromise.finally(() => {
        if (!request) return;
        if (request.closeTimer !== null) window.clearInterval(request.closeTimer);
        if (!request.isResolved) {
          if (activeLoginCaptcha === request) activeLoginCaptcha = null;
          request.instance?.reset();
        }
      });
    });
  }

  /**
   * 取消并清理当前登录验证码；请求身份不匹配时不影响新一轮验证码。
   *
   * @param {object} request 要清理的登录验证码请求。
   * @returns {void}
   */
  function resetLoginCaptcha(request: LoginCaptchaRequest) {
    if (activeLoginCaptcha === request) activeLoginCaptcha = null;
    if (request.closeTimer !== null) window.clearInterval(request.closeTimer);
    request.instance?.reset();
  }

  /**
   * 使旧登录验证码失败，避免账号切换后继续消费旧验证结果。
   *
   * @returns {void}
   */
  function cancelLoginCaptcha() {
    const request = activeLoginCaptcha;
    if (!request) return;
    activeLoginCaptcha = null;
    if (request.closeTimer !== null) window.clearInterval(request.closeTimer);
    request.reject(new Error(t("loginFailed")));
    request.instance?.reset();
  }

  /**
   * 初始化并打开人工 Geetest 验证码。
   *
   * @returns {Promise<void>} 验证窗口处理完成。
   */
  async function openCaptcha() {
    if (isSigning || isCaptchaOpening || hasVisibleCaptcha()) return;
    const generation = captchaGeneration;
    const isRushCaptcha = rushCaptchaGeneration !== null;
    isCaptchaOpening = true;
    try {
      await loadCaptcha();
      if (generation !== captchaGeneration) return;
      // 加载期间可能已关闭或重排 rush；旧流程不能在等待结束后再显示验证码。
      if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !isRushCaptchaPending))
        return;
      if (!captcha) {
        const init = geetestInit();
        if (!init) throw new Error(t("captchaNotLoaded"));
        const instance = await new Promise<CaptchaInstance>((resolve, reject) => {
          init(
            { captchaId: CAPTCHA_ID, product: "bind", language: captchaLanguage(), riskType: "slide" },
            (instance) => {
              instance
                .onReady(() => resolve(instance))
                .onError(reject)
                .onSuccess(() => {
                  if (generation === captchaGeneration) handleCaptchaSuccess(instance.getValidate());
                });
            },
          );
        });
        if (generation !== captchaGeneration) {
          instance.reset();
          return;
        }
        captcha = instance;
      }
      // 初始化回调本身也可能跨过取消边界，再次确认验证码仍归当前 rush。
      if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !isRushCaptchaPending))
        return;
      captcha.showCaptcha();
    } catch (error) {
      if (generation !== captchaGeneration) return;
      // Geetest 可能已插入弹窗后才回调异常，不能因此重复弹错。
      if (!hasVisibleCaptcha()) notify(error.message || t("captchaLoadFailed"));
    } finally {
      const shouldReopen =
        generation !== captchaGeneration &&
        (isRushCaptchaPending || (!isRushCaptcha && rushPreparationPromise === null));
      isCaptchaOpening = false;
      if (shouldReopen) openCaptchaWindow(isRushCaptchaPending, rushCaptchaGeneration);
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
    notify(t("signinSuccessWithRanking", { message: result.msg || t("signinSuccess"), rank: rankText }));
  }

  /**
   * 提交验证码结果完成签到。
   *
   * @param {object} validation Geetest v4 或 v3 验证结果。
   * @returns {Promise<void>} 签到请求完成。
   */
  async function sign(validation) {
    if (isSigning || !validation) return;
    isSigning = true;
    const submittedAt = serverNow();
    try {
      const result = await submitSignin(validation);
      if (result.code !== 1) throw new Error(result.msg || t("signinFailed"));
      await finishSignSuccess(result, submittedAt);
    } catch (error) {
      notify(error.message || t("signinFailed"));
      captcha?.reset?.();
    } finally {
      isSigning = false;
      // 普通提交占用验证码期间 rush 可能已完成准备；释放占用后补开当前验证码。
      if (isRushCaptchaPending) {
        openCaptchaWindow(true, rushCaptchaGeneration);
      }
    }
  }

  // 零点抢签到排程与提交流程。
  let rushTimer = null;
  let rushSubmitTimer = null;
  // 用对象身份隔离并发回包，旧轮次不能影响新轮次的重试定时器。
  let rushSubmitState = null;
  let isRushCaptchaPending = false;
  // 验证码回调属于哪个 rush 流程；取消后保留旧值，使迟到回调被丢弃而非普通提交。
  let rushCaptchaGeneration = null;
  let rushSubmitAt = 0;
  let rushTargetMidnight = 0;
  let rushPreparationPromise = null;
  let rushPreparingGeneration = 0;
  let rushPreparingTargetMidnight = 0;
  let rushScheduleGeneration = 0; // 异步校准完成后只接受最新调度代号。
  // 仅在关闭或手动重排时变更；次日排程不能误停当日仍在返回的重试请求。
  let rushFlowGeneration = 0;

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
    const hadRushSubmission = isRushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null;
    if (rushSubmitTimer !== null) clearTimeout(rushSubmitTimer);
    if (rushSubmitState) rushSubmitState.finished = true;
    rushSubmitTimer = null;
    rushSubmitState = null;
    isRushCaptchaPending = false;
    rushSubmitAt = 0;
    rushTargetMidnight = 0;
    rushPreparationPromise = null;
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
    notify(state.lastError?.message || t("signinFailed"));
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
            state.lastError = new Error(result?.msg || t("signinFailed"));
            finishRushSubmitIfDone(state);
          },
          (error) => {
            state.pending -= 1;
            if (!isCurrent()) return;
            state.lastError = error instanceof Error ? error : new Error(t("signinFailed"));
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
      !hasCredentials() ||
      !rushModeEnabled() ||
      (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) ||
      (rushTargetMidnight === targetMidnight &&
        (isRushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null)) ||
      (rushPreparationPromise &&
        rushPreparingGeneration === flowGeneration &&
        rushPreparingTargetMidnight === targetMidnight)
    ) {
      return;
    }
    if (
      rushTargetMidnight !== 0 &&
      rushTargetMidnight !== targetMidnight &&
      (isRushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null)
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
          (error) => (error instanceof Error ? error : new Error(t("captchaLoadFailed"))),
        );
      try {
        const statusRequest = sharedSigninStatus(accountStatus() !== "已登录");
        const statusStartedAt = statusRequest.startedAt;
        const result = await statusRequest;
        if (
          flowGeneration !== rushFlowGeneration ||
          !hasCredentials() ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
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
          !hasCredentials() ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
        ) {
          return;
        }
        rushCaptchaGeneration = flowGeneration;
        isRushCaptchaPending = true;
        notify(t("rushCaptchaOpened"));
        openCaptchaWindow(true, flowGeneration);
      } catch (error) {
        if (
          flowGeneration !== rushFlowGeneration ||
          !hasCredentials() ||
          rushSubmitAt !== submitAt ||
          rushTargetMidnight !== targetMidnight ||
          !rushModeEnabled() ||
          (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
        )
          return;
        rushSubmitAt = 0;
        rushTargetMidnight = 0;
        notify(t("rushPrepareFailed", { error: error.message || t("checkFailed") }));
      }
    })().finally(() => {
      // 旧 Promise 收尾时不能清空新一轮的准备状态。
      if (rushPreparationPromise === preparing) {
        rushPreparationPromise = null;
        rushPreparingGeneration = 0;
        rushPreparingTargetMidnight = 0;
      }
    });
    rushPreparationPromise = preparing;
    rushPreparingGeneration = flowGeneration;
    rushPreparingTargetMidnight = targetMidnight;
    return rushPreparationPromise;
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
    if (!hasCredentials() || !rushModeEnabled() || (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())) {
      return;
    }
    await calibrateServerClock();
    if (
      scheduleGeneration !== rushScheduleGeneration ||
      flowGeneration !== rushFlowGeneration ||
      !hasCredentials() ||
      !rushModeEnabled() ||
      (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
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
          !hasCredentials() ||
          !rushModeEnabled() ||
          (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
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
      !isRushCaptchaPending ||
      rushSubmitState !== null ||
      rushSubmitTimer !== null ||
      !rushModeEnabled() ||
      (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
    )
      return;
    const submitAt = rushSubmitAt;
    const targetMidnight = rushTargetMidnight;
    if (!submitAt || !targetMidnight) return;
    isRushCaptchaPending = false;
    if (serverNow() >= submitAt) {
      rushSubmitAt = 0;
      startRushSubmit(validation, flowGeneration, targetMidnight);
      return;
    }
    const delay = submitAt - serverNow();
    notify(t("captchaReady", { delay: formatDuration(delay) }));
    const timer = setTimeout(() => {
      if (rushSubmitTimer === timer) rushSubmitTimer = null;
      if (
        flowGeneration !== rushFlowGeneration ||
        rushCaptchaGeneration !== flowGeneration ||
        rushTargetMidnight !== targetMidnight ||
        !rushModeEnabled() ||
        (isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage())
      )
        return;
      rushSubmitAt = 0;
      startRushSubmit(validation, flowGeneration, targetMidnight);
    }, delay);
    rushSubmitTimer = timer;
  }

  // 轮询、通知和验证码窗口调度。
  let checkPromise = null;

  /**
   * 后台轮询每个自然日最多通知一次未签到状态；手动检查每次通知。
   *
   * @param {boolean} [shouldForce=false] 是否跳过每日通知限制。. Default is `false`
   * @param {number} elapsedMs 本次状态检查耗时。
   * @returns {void}
   */
  function notifyNeedSign(shouldForce = false, elapsedMs) {
    const date = new Date().toLocaleDateString("zh-CN");
    if (!shouldForce && GM_getValue(KEYS.notifiedDate, "") === date) return;
    GM_setValue(KEYS.notifiedDate, date);
    const duration = t("elapsed", { duration: formatDuration(elapsedMs) });
    notify(shouldForce || autoPopupEnabled() ? t("notSignedAuto", { duration }) : t("notSignedManual", { duration }));
  }

  /**
   * 检查登录和签到状态，按配置决定是否处理验证码。
   *
   * @param {object} [options] 本轮检查选项。
   * @param {boolean} [options.shouldForceCaptcha=false] 是否强制打开验证码流程。. Default is `false`
   * @param {boolean} [options.isManual=false] 是否由用户手动触发。. Default is `false`
   * @returns {Promise<object | void>} 本轮检查完成及结果。
   */
  function check({ shouldForceCaptcha = false, isManual = false } = {}) {
    if (!isManual && isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) {
      return Promise.resolve();
    }
    if (checkPromise) {
      return checkPromise.then((state) => {
        if (shouldForceCaptcha && state?.error) {
          notify(state.error.message || t("checkFailed"));
        } else if (shouldForceCaptcha && state?.result && !state.stale) {
          applyCheckResult(state.result, shouldForceCaptcha, state.elapsedMs, state.statusStartedAt);
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
        applyCheckResult(result, shouldForceCaptcha, elapsedMs, statusStartedAt);
        return { result, elapsedMs, statusStartedAt, error: null };
      } catch (error) {
        setAccountStatus(hasCredentials() ? "登录失败" : "未设置");
        if (shouldForceCaptcha) notify(error.message || t("checkFailed"));
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
      if (checkPromise === settled) checkPromise = null;
    });
    checkPromise = settled;
    return settled;
  }

  /**
   * 处理一次签到状态结果。
   *
   * @param {object} result 接口响应。
   * @param {boolean} shouldForceCaptcha 是否强制打开验证码流程。
   * @param {number} elapsedMs 检查耗时。
   * @param {number} statusStartedAt 状态请求开始时的服务端时间。
   * @returns {void}
   */
  function applyCheckResult(result, shouldForceCaptcha, elapsedMs, statusStartedAt = serverNow()) {
    setAccountStatus("已登录");
    if (result.signin) {
      stopRushForKnownSignin(statusStartedAt);
      if (shouldForceCaptcha) {
        notify(t("alreadySigned", { duration: formatDuration(elapsedMs) }));
      }
      return;
    }
    notifyNeedSign(shouldForceCaptcha, elapsedMs);
    if (shouldForceCaptcha || autoPopupEnabled()) {
      openCaptchaWindow();
    }
  }

  /**
   * 在当前页面最多打开一个验证码窗口。
   *
   * @param {boolean} [isRush=false] 是否由 rush 准备流程调用。. Default is `false`
   * @param {number | null} [flowGeneration=null] Rush 流程代号。. Default is `null`
   * @returns {void}
   */
  function openCaptchaWindow(isRush = false, flowGeneration = null) {
    // rush 准备期间普通流程让位，避免两个异步回调争抢同一个验证码实例。
    const canOpen = isRush
      ? flowGeneration === rushFlowGeneration && rushCaptchaGeneration === flowGeneration && isRushCaptchaPending
      : rushPreparationPromise === null && !isRushCaptchaPending;
    if (rushSubmitTimer === null && rushSubmitState === null && canOpen && !hasVisibleCaptcha()) {
      if (!isRush) rushCaptchaGeneration = null;
      openCaptcha();
    }
  }

  registerMenus();

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
