// ==UserScript==
// @name               BlogsClub Check-in Helper
// @name:zh            BlogsClub 签到助手
// @name:zh-CN         BlogsClub 签到助手
// @name:zh-TW         BlogsClub 簽到助手
// @namespace          https://howiehz.top
// @version            0.3.2
// @author             HowieHz
// @description        Checks BlogsClub check-in status in the background (BlogsClub pages by default) and supports manual CAPTCHA verification.
// @description:zh     默认仅在 BlogsClub 页面后台检查签到状态，并支持手动完成验证码。
// @description:zh-CN  默认仅在 BlogsClub 页面后台检查签到状态，并支持手动完成验证码。
// @description:zh-TW  預設僅在 BlogsClub 頁面背景檢查簽到狀態，並支援手動完成驗證碼。
// @license            MIT
// @homepageURL        https://howiehz.top/misc/blogsclub-signin-helper/
// @supportURL         https://github.com/HowieHz/howiehz-misc/issues
// @match              *://*/*
// @connect            www.blogsclub.org
// @connect            static.geetest.com
// @grant              GM_getValue
// @grant              GM_notification
// @grant              GM_registerMenuCommand
// @grant              GM_setValue
// @grant              GM_unregisterMenuCommand
// @grant              GM_xmlhttpRequest
// @grant              unsafeWindow
// @run-at             document-idle
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	if (window.top === window && !window.__BLOGSCLUB_AUTO_SIGNIN__) {
		window.__BLOGSCLUB_AUTO_SIGNIN__ = true;
		const API = "https://www.blogsclub.org";
		const CAPTCHA_ID = "f70029ad5e8b031ff90bd54bce240f14";
		const DEFAULT_INTERVAL_MS = 10 * 1e3;
		const MIN_INTERVAL_MS = 1;
		const MAX_INTERVAL_MS = 1440 * 60 * 1e3;
		const DEFAULT_RUSH_LEAD_SECONDS = 5;
		const MIN_RUSH_LEAD_SECONDS = 1;
		const MAX_RUSH_LEAD_SECONDS = 60;
		const DEFAULT_RUSH_SUBMIT_DELAY_MS = 500;
		const MIN_RUSH_SUBMIT_DELAY_MS = 0;
		const MAX_RUSH_SUBMIT_DELAY_MS = 60 * 1e3;
		const DEFAULT_RUSH_SUBMIT_RETRIES = 50;
		const MIN_RUSH_SUBMIT_RETRIES = 0;
		const MAX_RUSH_SUBMIT_RETRIES = Number.MAX_SAFE_INTEGER;
		const DEFAULT_RUSH_SUBMIT_INTERVAL_MS = 200;
		const MIN_RUSH_SUBMIT_INTERVAL_MS = 1;
		const MAX_RUSH_SUBMIT_INTERVAL_MS = 60 * 1e3;
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
			notifiedDate: "blogsclub-auto-signin-notified"
		};
		const MESSAGES = {
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
				notSignedManual: "You have not checked in today. Use the userscript menu to choose “Check now / check in”{duration}.",
				checkingStatus: "Checking check-in status…",
				alreadySigned: "Already checked in today ({duration}).",
				elapsed: " ({duration})",
				durationSeconds: "{value} seconds",
				durationMilliseconds: "{value} ms"
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
				durationMilliseconds: "{value} 毫秒"
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
				durationMilliseconds: "{value} 毫秒"
			}
		};
		function isLanguage(value) {
			return value === "en" || value === "zh-Hans" || value === "zh-Hant";
		}
		function detectLanguage() {
			const preferences = [...navigator.languages || [], navigator.language];
			for (const preference of preferences) {
				const locale = preference.toLowerCase().replaceAll("_", "-");
				if (locale.startsWith("zh-tw") || locale.startsWith("zh-hant") || locale.startsWith("zh-hk") || locale.startsWith("zh-mo")) return "zh-Hant";
				if (locale.startsWith("zh-")) return "zh-Hans";
				if (locale === "zh") return "zh-Hans";
				if (locale.startsWith("en")) return "en";
			}
			return "en";
		}
		function currentLanguage() {
			const saved = GM_getValue(KEYS.language, null);
			if (isLanguage(saved)) return saved;
			const detected = detectLanguage();
			GM_setValue(KEYS.language, detected);
			return detected;
		}
		function t(key, values = {}) {
			return (MESSAGES[currentLanguage()][key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
		}
		function languageName(language) {
			return t(language === "en" ? "languageEnglish" : language === "zh-Hans" ? "languageSimplifiedChinese" : "languageTraditionalChinese");
		}
		function languageIndex(language) {
			return language === "en" ? 1 : language === "zh-Hans" ? 2 : 3;
		}
		function captchaLanguage() {
			const language = currentLanguage();
			return language === "en" ? "eng" : language === "zh-Hant" ? "cht" : "zho";
		}
		const menuIds = new Map();
		function notify(text, title = t("notificationTitle")) {
			if (typeof GM_notification === "function") GM_notification({
				title,
				text,
				timeout: 5e3
			});
			else console.info(`[${title}] ${text}`);
		}
		function formatDuration(milliseconds) {
			if (milliseconds >= 1e3) return t("durationSeconds", { value: Number((milliseconds / 1e3).toFixed(2)) });
			return t("durationMilliseconds", { value: Math.round(milliseconds) });
		}
		function registerMenu(name, label, handler) {
			const currentId = menuIds.get(name);
			if (currentId !== void 0 && typeof GM_unregisterMenuCommand === "function") GM_unregisterMenuCommand(currentId);
			menuIds.set(name, GM_registerMenuCommand(label, handler));
		}
		function credentials() {
			return GM_getValue(KEYS.credentials, {}) || {};
		}
		function hasCredentials() {
			const { email, password } = credentials();
			return Boolean(email && password);
		}
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
			GM_setValue(KEYS.credentials, {
				email: email.trim(),
				password
			});
			GM_setValue(KEYS.accountStatus, "已保存");
			registerMenus();
			notify(t("accountSaved"), t("configTitle"));
			if (rushModeEnabled()) restartRushCheck();
			login().then(() => {
				setAccountStatus("已登录");
				notify(t("loginSuccess"), t("configTitle"));
				check();
			}).catch(() => {
				setAccountStatus("登录失败");
				notify(t("loginFailed"), t("configTitle"));
			});
		}
		function intervalMs() {
			const value = Number(GM_getValue(KEYS.interval, DEFAULT_INTERVAL_MS));
			return Number.isSafeInteger(value) && value >= MIN_INTERVAL_MS && value <= MAX_INTERVAL_MS ? value : DEFAULT_INTERVAL_MS;
		}
		function configureInterval() {
			const input = prompt(t("intervalPrompt", {
				min: MIN_INTERVAL_MS,
				max: MAX_INTERVAL_MS
			}), String(intervalMs()));
			if (input === null) return;
			const value = Number(input.trim());
			if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) {
				notify(t("invalidInterval", {
					min: MIN_INTERVAL_MS,
					max: MAX_INTERVAL_MS
				}), t("configTitle"));
				return;
			}
			GM_setValue(KEYS.interval, value);
			registerMenus();
			notify(t("intervalSaved", { value }), t("configTitle"));
			check();
		}
		function autoPopupEnabled() {
			return GM_getValue(KEYS.autoPopup, true) === true;
		}
		function rushModeEnabled() {
			return GM_getValue(KEYS.rushMode, true) === true;
		}
		function rushLeadSeconds() {
			const value = Number(GM_getValue(KEYS.rushLeadSeconds, DEFAULT_RUSH_LEAD_SECONDS));
			return Number.isSafeInteger(value) && value >= MIN_RUSH_LEAD_SECONDS && value <= MAX_RUSH_LEAD_SECONDS ? value : DEFAULT_RUSH_LEAD_SECONDS;
		}
		function rushSubmitDelayMs() {
			const value = Number(GM_getValue(KEYS.rushSubmitDelayMs, DEFAULT_RUSH_SUBMIT_DELAY_MS));
			return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_DELAY_MS && value <= MAX_RUSH_SUBMIT_DELAY_MS ? value : DEFAULT_RUSH_SUBMIT_DELAY_MS;
		}
		function rushSubmitRetries() {
			const value = Number(GM_getValue(KEYS.rushSubmitRetries, DEFAULT_RUSH_SUBMIT_RETRIES));
			return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_RETRIES && value <= MAX_RUSH_SUBMIT_RETRIES ? value : DEFAULT_RUSH_SUBMIT_RETRIES;
		}
		function rushSubmitIntervalMs() {
			const value = Number(GM_getValue(KEYS.rushSubmitIntervalMs, DEFAULT_RUSH_SUBMIT_INTERVAL_MS));
			return Number.isSafeInteger(value) && value >= MIN_RUSH_SUBMIT_INTERVAL_MS && value <= MAX_RUSH_SUBMIT_INTERVAL_MS ? value : DEFAULT_RUSH_SUBMIT_INTERVAL_MS;
		}
		function isBlogsClubPage() {
			const hostname = window.location.hostname.toLowerCase();
			return hostname === "blogsclub.org" || hostname.endsWith(".blogsclub.org");
		}
		function isBlogsClubAutoCheckOnlyEnabled() {
			return GM_getValue(KEYS.blogsClubAutoCheckOnly, true) === true;
		}
		function accountStatus() {
			if (!hasCredentials()) return "未设置";
			return GM_getValue(KEYS.accountStatus, "已保存");
		}
		function accountStatusLabel() {
			switch (accountStatus()) {
				case "已保存": return t("statusSaved");
				case "已登录": return t("statusLoggedIn");
				case "登录失败": return t("statusLoginFailed");
				default: return t("statusNotConfigured");
			}
		}
		function registerIntervalMenu() {
			registerMenu("interval", t("intervalMenu", { value: intervalMs() }), configureInterval);
		}
		function registerCheckMenu() {
			registerMenu("check", t("checkNowMenu"), () => {
				notify(t("checkingStatus"));
				return check({
					isManual: true,
					shouldForceCaptcha: true
				});
			});
		}
		function registerAccountMenu() {
			registerMenu("account", t("accountMenu", { status: accountStatusLabel() }), configureAccount);
		}
		function registerBlogsClubAutoCheckOnlyMenu() {
			registerMenu("blogsClubAutoCheckOnly", t("blogsClubAutoCheckOnlyMenu", { state: t(isBlogsClubAutoCheckOnlyEnabled() ? "enabled" : "disabled") }), toggleBlogsClubAutoCheckOnly);
		}
		function registerAutoPopupMenu() {
			registerMenu("autoPopup", t("autoPopupMenu", { state: t(autoPopupEnabled() ? "enabled" : "disabled") }), toggleAutoPopup);
		}
		function registerRushModeMenu() {
			registerMenu("rushMode", t("rushModeMenu", { state: t(rushModeEnabled() ? "enabled" : "disabled") }), toggleRushMode);
		}
		function registerRushLeadMenu() {
			registerMenu("rushLead", t("rushLeadMenu", { value: rushLeadSeconds() }), configureRushLead);
		}
		function configureRushLead() {
			const input = prompt(t("rushLeadPrompt", {
				min: MIN_RUSH_LEAD_SECONDS,
				max: MAX_RUSH_LEAD_SECONDS
			}), String(rushLeadSeconds()));
			if (input === null) return;
			const value = Number(input.trim());
			if (!Number.isSafeInteger(value) || value < MIN_RUSH_LEAD_SECONDS || value > MAX_RUSH_LEAD_SECONDS) {
				notify(t("invalidRushLead", {
					min: MIN_RUSH_LEAD_SECONDS,
					max: MAX_RUSH_LEAD_SECONDS
				}), t("configTitle"));
				return;
			}
			GM_setValue(KEYS.rushLeadSeconds, value);
			registerMenus();
			notify(t("rushLeadSaved", { value }), t("configTitle"));
			if (rushModeEnabled()) restartRushCheck();
		}
		function registerRushSubmitDelayMenu() {
			registerMenu("rushSubmitDelay", t("rushSubmitDelayMenu", { value: rushSubmitDelayMs() }), configureRushSubmitDelay);
		}
		function configureRushSubmitDelay() {
			const input = prompt(t("rushSubmitDelayPrompt", {
				min: MIN_RUSH_SUBMIT_DELAY_MS,
				max: MAX_RUSH_SUBMIT_DELAY_MS
			}), String(rushSubmitDelayMs()));
			if (input === null) return;
			const value = Number(input.trim());
			if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_DELAY_MS || value > MAX_RUSH_SUBMIT_DELAY_MS) {
				notify(t("invalidRushSubmitDelay", {
					min: MIN_RUSH_SUBMIT_DELAY_MS,
					max: MAX_RUSH_SUBMIT_DELAY_MS
				}), t("configTitle"));
				return;
			}
			GM_setValue(KEYS.rushSubmitDelayMs, value);
			registerMenus();
			notify(t("rushSubmitDelaySaved", { value }), t("configTitle"));
			if (rushModeEnabled()) restartRushCheck();
		}
		function registerRushSubmitRetriesMenu() {
			registerMenu("rushSubmitRetries", t("rushSubmitRetriesMenu", { value: rushSubmitRetries() }), configureRushSubmitRetries);
		}
		function configureRushSubmitRetries() {
			const input = prompt(t("rushSubmitRetriesPrompt", {
				min: MIN_RUSH_SUBMIT_RETRIES,
				max: MAX_RUSH_SUBMIT_RETRIES
			}), String(rushSubmitRetries()));
			if (input === null) return;
			const value = Number(input.trim());
			if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_RETRIES || value > MAX_RUSH_SUBMIT_RETRIES) {
				notify(t("invalidRushSubmitRetries", {
					min: MIN_RUSH_SUBMIT_RETRIES,
					max: MAX_RUSH_SUBMIT_RETRIES
				}), t("configTitle"));
				return;
			}
			GM_setValue(KEYS.rushSubmitRetries, value);
			registerMenus();
			notify(t("rushSubmitRetriesSaved", { value }), t("configTitle"));
		}
		function registerRushSubmitIntervalMenu() {
			registerMenu("rushSubmitInterval", t("rushSubmitIntervalMenu", { value: rushSubmitIntervalMs() }), configureRushSubmitInterval);
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
			const selected = value === 1 ? "en" : value === 2 ? "zh-Hans" : value === 3 ? "zh-Hant" : null;
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
			if (hadVisibleCaptcha) openCaptchaWindow(isRushCaptchaPending, rushCaptchaGeneration);
		}
		function configureRushSubmitInterval() {
			const input = prompt(t("rushSubmitIntervalPrompt", {
				min: MIN_RUSH_SUBMIT_INTERVAL_MS,
				max: MAX_RUSH_SUBMIT_INTERVAL_MS
			}), String(rushSubmitIntervalMs()));
			if (input === null) return;
			const value = Number(input.trim());
			if (!Number.isSafeInteger(value) || value < MIN_RUSH_SUBMIT_INTERVAL_MS || value > MAX_RUSH_SUBMIT_INTERVAL_MS) {
				notify(t("invalidRushSubmitInterval", {
					min: MIN_RUSH_SUBMIT_INTERVAL_MS,
					max: MAX_RUSH_SUBMIT_INTERVAL_MS
				}), t("configTitle"));
				return;
			}
			GM_setValue(KEYS.rushSubmitIntervalMs, value);
			registerMenus();
			notify(t("rushSubmitIntervalSaved", { value }), t("configTitle"));
		}
		function toggleAutoPopup() {
			const isEnabled = !autoPopupEnabled();
			GM_setValue(KEYS.autoPopup, isEnabled);
			registerMenus();
			notify(t("autoPopupChanged", { state: isEnabled ? t("enabled") : t("disabled") }), t("configTitle"));
			if (isEnabled) check({ shouldForceCaptcha: true });
		}
		function toggleBlogsClubAutoCheckOnly() {
			const isEnabled = !isBlogsClubAutoCheckOnlyEnabled();
			GM_setValue(KEYS.blogsClubAutoCheckOnly, isEnabled);
			registerMenus();
			notify(t("blogsClubAutoCheckOnlyChanged", { state: isEnabled ? t("enabled") : t("disabled") }), t("configTitle"));
			if (rushModeEnabled()) if (isEnabled && !isBlogsClubPage()) cancelRushMode();
			else restartRushCheck();
			check();
		}
		function toggleRushMode() {
			const enabled = !rushModeEnabled();
			GM_setValue(KEYS.rushMode, enabled);
			registerMenus();
			notify(t("rushModeChanged", { state: enabled ? t("enabled") : t("disabled") }), t("configTitle"));
			if (enabled) scheduleRushCheck();
			else cancelRushMode();
		}
		function setAccountStatus(status) {
			if (accountStatus() === status) return;
			GM_setValue(KEYS.accountStatus, status);
			registerMenus();
		}
		let loginPromise = null;
		let loginPagePromise = null;
		let signinStatusPromise = null;
		let isSigninStatusLoginForced = false;
		let serverClockOffsetMs = null;
		function updateServerClock(response, startedAt, receivedAt) {
			const date = String(response.responseHeaders || "").match(/^date:\s*(.+)$/im)?.[1];
			const serverTime = date ? Date.parse(date) : NaN;
			if (Number.isFinite(serverTime)) serverClockOffsetMs = serverTime - (startedAt + receivedAt) / 2;
		}
		function request({ method, url, data, headers, parseJson = true, timeout = 2e4 }) {
			return new Promise((resolve, reject) => {
				const startedAt = Date.now();
				GM_xmlhttpRequest({
					method,
					url,
					data,
					anonymous: false,
					headers: headers || (data ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : void 0),
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
							resolve(JSON.parse(text));
						} catch {
							reject(new Error(t("responseFormatError")));
						}
					},
					onerror: () => reject(new Error(t("networkFailure"))),
					ontimeout: () => reject(new Error(t("requestTimeout")))
				});
			});
		}
		function form(data) {
			return new URLSearchParams(data).toString();
		}
		function loginPage() {
			if (!loginPagePromise) loginPagePromise = request({
				method: "GET",
				url: `${API}/login.html`,
				parseJson: false
			}).finally(() => {
				loginPagePromise = null;
			});
			return loginPagePromise;
		}
		async function login() {
			const { email, password } = credentials();
			if (!hasCredentials()) throw new Error(t("accountRequired"));
			const token = (await loginPage()).match(/window\.bcToken\s*=\s*["']([^"']+)["']/)?.[1];
			if (!token) throw new Error(t("loginTokenMissing"));
			const result = await request({
				method: "POST",
				url: `${API}/index.php/getLogin`,
				data: form({
					type: "password",
					email,
					password,
					token
				})
			});
			if (result.code !== 1) throw new Error(result.msg || t("loginFailed"));
		}
		function profile(action, extra = {}) {
			return request({
				method: "POST",
				url: `${API}/index.php/getProfile`,
				data: form({
					action,
					...extra
				})
			});
		}
		async function signinRankText() {
			try {
				const [result, page] = await Promise.all([profile("signinRank"), request({
					method: "GET",
					url: `${API}/usercenter.html`,
					parseJson: false
				})]);
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
		async function signinStatus(shouldForceLogin = false) {
			let result;
			if (!shouldForceLogin) try {
				result = await profile("signinStatus");
				if (result.code === 1) return result;
			} catch {}
			if (!loginPromise) loginPromise = login().finally(() => {
				loginPromise = null;
			});
			await loginPromise;
			result = await profile("signinStatus");
			if (result.code !== 1) throw new Error(result.msg || t("loginSessionExpired"));
			return result;
		}
		function sharedSigninStatus(shouldForceLogin = false) {
			if (signinStatusPromise && (!shouldForceLogin || isSigninStatusLoginForced)) return signinStatusPromise;
			const startedAt = serverNow();
			const shared = signinStatus(shouldForceLogin).finally(() => {
				if (signinStatusPromise === shared) {
					signinStatusPromise = null;
					isSigninStatusLoginForced = false;
				}
			});
			shared.startedAt = startedAt;
			signinStatusPromise = shared;
			isSigninStatusLoginForced = shouldForceLogin;
			return shared;
		}
		let captcha = null;
		let captchaGeneration = 0;
		let captchaLoadPromise = null;
		let isCaptchaOpening = false;
		let isSigning = false;
		let signinSuccessSerial = 0;
		let lastSigninSuccessAt = 0;
		function hasVisibleCaptcha() {
			return [...document.querySelectorAll("[class*=\"geetest\"], [id*=\"geetest\"], [class*=\"geevisit\"], [id*=\"geevisit\"], [data-geetest], [data-geetest-id], iframe[src*=\"geetest\"], iframe[src*=\"geevisit\"], iframe[src*=\"captcha\"]")].some((element) => {
				const style = getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
				const rect = element.getBoundingClientRect();
				const htmlElement = element;
				return rect.width > 0 && rect.height > 0 || htmlElement.offsetWidth > 0 && htmlElement.offsetHeight > 0;
			});
		}
		function geetestInit() {
			if (typeof unsafeWindow.initGeetest4 === "function") return unsafeWindow.initGeetest4;
			if (typeof window.initGeetest4 === "function") return window.initGeetest4;
			return null;
		}
		function loadCaptcha() {
			if (geetestInit()) return Promise.resolve();
			if (captchaLoadPromise) return captchaLoadPromise;
			captchaLoadPromise = new Promise((resolve, reject) => {
				const script = document.createElement("script");
				script.src = "https://static.geetest.com/v4/gt4.js";
				script.onload = () => setTimeout(() => {
					if (geetestInit()) resolve();
					else reject(new Error(t("captchaNotLoaded")));
				}, 0);
				script.onerror = () => reject(new Error(t("captchaLoadFailed")));
				(document.head || document.documentElement).appendChild(script);
			}).finally(() => {
				captchaLoadPromise = null;
			});
			return captchaLoadPromise;
		}
		async function openCaptcha() {
			if (isSigning || isCaptchaOpening || hasVisibleCaptcha()) return;
			const generation = captchaGeneration;
			const isRushCaptcha = rushCaptchaGeneration !== null;
			isCaptchaOpening = true;
			try {
				await loadCaptcha();
				if (generation !== captchaGeneration) return;
				if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !isRushCaptchaPending)) return;
				if (!captcha) {
					const init = geetestInit();
					if (!init) throw new Error(t("captchaNotLoaded"));
					const instance = await new Promise((resolve, reject) => {
						init({
							captchaId: CAPTCHA_ID,
							product: "bind",
							language: captchaLanguage(),
							riskType: "slide"
						}, (instance) => {
							instance.onReady(() => resolve(instance)).onError(reject).onSuccess(() => {
								if (generation === captchaGeneration) handleCaptchaSuccess(instance.getValidate());
							});
						});
					});
					if (generation !== captchaGeneration) {
						instance.reset();
						return;
					}
					captcha = instance;
				}
				if (rushCaptchaGeneration !== null && (rushCaptchaGeneration !== rushFlowGeneration || !isRushCaptchaPending)) return;
				captcha.showCaptcha();
			} catch (error) {
				if (generation !== captchaGeneration) return;
				if (!hasVisibleCaptcha()) notify(error.message || t("captchaLoadFailed"));
			} finally {
				const shouldReopen = generation !== captchaGeneration && (isRushCaptchaPending || !isRushCaptcha && rushPreparationPromise === null);
				isCaptchaOpening = false;
				if (shouldReopen) openCaptchaWindow(isRushCaptchaPending, rushCaptchaGeneration);
			}
		}
		function submitSignin(validation) {
			return profile("signin", { verify_bind_token_sign: JSON.stringify({
				...validation,
				captcha_id: CAPTCHA_ID
			}) });
		}
		async function finishSignSuccess(result, submittedAt = serverNow()) {
			signinSuccessSerial += 1;
			lastSigninSuccessAt = submittedAt;
			stopRushForKnownSignin(submittedAt);
			captcha?.reset?.();
			const rankText = await signinRankText();
			notify(t("signinSuccessWithRanking", {
				message: result.msg || t("signinSuccess"),
				rank: rankText
			}));
		}
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
				if (isRushCaptchaPending) openCaptchaWindow(true, rushCaptchaGeneration);
			}
		}
		let rushTimer = null;
		let rushSubmitTimer = null;
		let rushSubmitState = null;
		let isRushCaptchaPending = false;
		let rushCaptchaGeneration = null;
		let rushSubmitAt = 0;
		let rushTargetMidnight = 0;
		let rushPreparationPromise = null;
		let rushPreparingGeneration = 0;
		let rushPreparingTargetMidnight = 0;
		let rushScheduleGeneration = 0;
		let rushFlowGeneration = 0;
		function serverNow() {
			return Date.now() + (serverClockOffsetMs || 0);
		}
		function nextServerMidnight() {
			const now = new Date(serverNow());
			now.setHours(24, 0, 0, 0);
			return now.getTime();
		}
		async function calibrateServerClock() {
			try {
				await loginPage();
			} catch {}
		}
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
			if (hadRushSubmission) captcha?.reset?.();
		}
		function stopRushForKnownSignin(submittedAt) {
			if (!rushTargetMidnight || submittedAt < rushTargetMidnight) return;
			clearRushFlow();
		}
		function cancelRushMode() {
			rushScheduleGeneration += 1;
			rushFlowGeneration += 1;
			if (rushTimer !== null) clearTimeout(rushTimer);
			rushTimer = null;
			clearRushFlow();
		}
		function restartRushCheck() {
			cancelRushMode();
			scheduleRushCheck();
		}
		function finishRushSubmit(state, result) {
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
				finishSignSuccess(result, state.firstSubmittedAt);
				return;
			}
			notify(state.lastError?.message || t("signinFailed"));
			captcha?.reset?.();
		}
		function finishRushSubmitIfDone(state) {
			if (state.sent < state.totalAttempts || state.pending > 0) return;
			finishRushSubmit(state, null);
		}
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
				lastError: null
			};
			rushSubmitState = state;
			const isCurrent = () => rushSubmitState === state && !state.finished && state.flowGeneration === rushFlowGeneration;
			const submit = () => {
				if (!isCurrent()) return;
				state.sent += 1;
				state.pending += 1;
				Promise.resolve().then(() => submitSignin(validation)).then((result) => {
					state.pending -= 1;
					if (!isCurrent()) return;
					if (result?.code === 1) {
						finishRushSubmit(state, result);
						return;
					}
					state.lastError = new Error(result?.msg || t("signinFailed"));
					finishRushSubmitIfDone(state);
				}, (error) => {
					state.pending -= 1;
					if (!isCurrent()) return;
					state.lastError = error instanceof Error ? error : new Error(t("signinFailed"));
					finishRushSubmitIfDone(state);
				});
				if (state.sent < state.totalAttempts && isCurrent()) {
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
		async function prepareRushCaptcha(submitAt, targetMidnight, flowGeneration) {
			if (flowGeneration !== rushFlowGeneration || !hasCredentials() || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage() || rushTargetMidnight === targetMidnight && (isRushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null) || rushPreparationPromise && rushPreparingGeneration === flowGeneration && rushPreparingTargetMidnight === targetMidnight) return;
			if (rushTargetMidnight !== 0 && rushTargetMidnight !== targetMidnight && (isRushCaptchaPending || rushSubmitTimer !== null || rushSubmitState !== null)) clearRushFlow();
			rushSubmitAt = submitAt;
			rushTargetMidnight = targetMidnight;
			const successSerialAtStart = signinSuccessSerial;
			const preparing = (async () => {
				const captchaReady = Promise.resolve().then(() => loadCaptcha()).then(() => null, (error) => error instanceof Error ? error : new Error(t("captchaLoadFailed")));
				try {
					const statusRequest = sharedSigninStatus(accountStatus() !== "已登录");
					const statusStartedAt = statusRequest.startedAt;
					const result = await statusRequest;
					if (flowGeneration !== rushFlowGeneration || !hasCredentials() || rushSubmitAt !== submitAt || rushTargetMidnight !== targetMidnight || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
					setAccountStatus("已登录");
					if (signinSuccessSerial !== successSerialAtStart && lastSigninSuccessAt >= targetMidnight) {
						rushSubmitAt = 0;
						rushTargetMidnight = 0;
						return;
					}
					if (result.signin && statusStartedAt >= targetMidnight) {
						rushSubmitAt = 0;
						rushTargetMidnight = 0;
						return;
					}
					const captchaError = await captchaReady;
					if (captchaError) throw captchaError;
					if (flowGeneration !== rushFlowGeneration || !hasCredentials() || rushSubmitAt !== submitAt || rushTargetMidnight !== targetMidnight || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
					rushCaptchaGeneration = flowGeneration;
					isRushCaptchaPending = true;
					notify(t("rushCaptchaOpened"));
					openCaptchaWindow(true, flowGeneration);
				} catch (error) {
					if (flowGeneration !== rushFlowGeneration || !hasCredentials() || rushSubmitAt !== submitAt || rushTargetMidnight !== targetMidnight || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
					rushSubmitAt = 0;
					rushTargetMidnight = 0;
					notify(t("rushPrepareFailed", { error: error.message || t("checkFailed") }));
				}
			})().finally(() => {
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
		async function scheduleRushCheck() {
			const scheduleGeneration = ++rushScheduleGeneration;
			const flowGeneration = rushFlowGeneration;
			if (rushTimer !== null) clearTimeout(rushTimer);
			rushTimer = null;
			if (!hasCredentials() || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
			await calibrateServerClock();
			if (scheduleGeneration !== rushScheduleGeneration || flowGeneration !== rushFlowGeneration || !hasCredentials() || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
			const targetMidnight = nextServerMidnight();
			const submitAt = targetMidnight + rushSubmitDelayMs();
			const prepareAt = targetMidnight - rushLeadSeconds() * 1e3;
			rushTimer = setTimeout(() => {
				if (scheduleGeneration !== rushScheduleGeneration || flowGeneration !== rushFlowGeneration || !hasCredentials() || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
				rushTimer = null;
				prepareRushCaptcha(submitAt, targetMidnight, flowGeneration);
				rushTimer = setTimeout(() => {
					if (scheduleGeneration !== rushScheduleGeneration || flowGeneration !== rushFlowGeneration) return;
					rushTimer = null;
					scheduleRushCheck();
				}, Math.max(1, submitAt + 100 - serverNow()));
			}, Math.max(0, prepareAt - serverNow()));
		}
		function handleCaptchaSuccess(validation) {
			if (!validation) return;
			const flowGeneration = rushCaptchaGeneration;
			if (flowGeneration === null) {
				sign(validation);
				return;
			}
			if (flowGeneration !== rushFlowGeneration || !isRushCaptchaPending || rushSubmitState !== null || rushSubmitTimer !== null || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
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
				if (flowGeneration !== rushFlowGeneration || rushCaptchaGeneration !== flowGeneration || rushTargetMidnight !== targetMidnight || !rushModeEnabled() || isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return;
				rushSubmitAt = 0;
				startRushSubmit(validation, flowGeneration, targetMidnight);
			}, delay);
			rushSubmitTimer = timer;
		}
		let checkPromise = null;
		function notifyNeedSign(shouldForce = false, elapsedMs) {
			const date = new Date().toLocaleDateString("zh-CN");
			if (!shouldForce && GM_getValue(KEYS.notifiedDate, "") === date) return;
			GM_setValue(KEYS.notifiedDate, date);
			const duration = t("elapsed", { duration: formatDuration(elapsedMs) });
			notify(shouldForce || autoPopupEnabled() ? t("notSignedAuto", { duration }) : t("notSignedManual", { duration }));
		}
		function check({ shouldForceCaptcha = false, isManual = false } = {}) {
			if (!isManual && isBlogsClubAutoCheckOnlyEnabled() && !isBlogsClubPage()) return Promise.resolve();
			if (checkPromise) return checkPromise.then((state) => {
				if (shouldForceCaptcha && state?.error) notify(state.error.message || t("checkFailed"));
				else if (shouldForceCaptcha && state?.result && !state.stale) applyCheckResult(state.result, shouldForceCaptcha, state.elapsedMs, state.statusStartedAt);
				return state;
			});
			const settled = (async () => {
				const startedAt = performance.now();
				const successSerialAtStart = signinSuccessSerial;
				let statusStartedAt = serverNow();
				try {
					const statusRequest = sharedSigninStatus(accountStatus() !== "已登录");
					statusStartedAt = statusRequest.startedAt;
					const result = await statusRequest;
					const elapsedMs = performance.now() - startedAt;
					if (!result.signin && signinSuccessSerial !== successSerialAtStart && lastSigninSuccessAt >= statusStartedAt) return {
						result,
						elapsedMs,
						statusStartedAt,
						stale: true,
						error: null
					};
					applyCheckResult(result, shouldForceCaptcha, elapsedMs, statusStartedAt);
					return {
						result,
						elapsedMs,
						statusStartedAt,
						error: null
					};
				} catch (error) {
					setAccountStatus(hasCredentials() ? "登录失败" : "未设置");
					if (shouldForceCaptcha) notify(error.message || t("checkFailed"));
					return {
						result: null,
						elapsedMs: performance.now() - startedAt,
						statusStartedAt,
						error
					};
				}
			})().finally(() => {
				if (checkPromise === settled) checkPromise = null;
			});
			checkPromise = settled;
			return settled;
		}
		function applyCheckResult(result, shouldForceCaptcha, elapsedMs, statusStartedAt = serverNow()) {
			setAccountStatus("已登录");
			if (result.signin) {
				stopRushForKnownSignin(statusStartedAt);
				if (shouldForceCaptcha) notify(t("alreadySigned", { duration: formatDuration(elapsedMs) }));
				return;
			}
			notifyNeedSign(shouldForceCaptcha, elapsedMs);
			if (shouldForceCaptcha || autoPopupEnabled()) openCaptchaWindow();
		}
		function openCaptchaWindow(isRush = false, flowGeneration = null) {
			if (rushSubmitTimer === null && rushSubmitState === null && (isRush ? flowGeneration === rushFlowGeneration && rushCaptchaGeneration === flowGeneration && isRushCaptchaPending : rushPreparationPromise === null && !isRushCaptchaPending) && !hasVisibleCaptcha()) {
				if (!isRush) rushCaptchaGeneration = null;
				openCaptcha();
			}
		}
		registerMenus();
		check();
		function scheduleChecks() {
			setTimeout(async () => {
				await check();
				scheduleChecks();
			}, intervalMs());
		}
		scheduleChecks();
		scheduleRushCheck();
	}
})();
