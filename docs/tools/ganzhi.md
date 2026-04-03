---
publish: false
published: 2026-04-03T20:00:00+08:00
---

# 天干地支计算器

<!-- autocorrect-disable -->
<script setup lang="ts">
import { Foto, Lunar, LunarMonth, LunarYear, Solar, Tao } from "lunar-javascript";
import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";

type CalendarMode = "solar" | "lunar" | "foto" | "tao";
type LunisolarMode = Exclude<CalendarMode, "solar">;
type YearType = "0" | "1";
type DayType = "0" | "1";
type ParseIssue = "year-range" | "invalid-date";

const LUNISOLAR_MODES = ["lunar", "foto", "tao"] as const satisfies readonly LunisolarMode[];

interface SelectOption {
  label: string;
  value: string;
}

interface DateBoundary {
  year: number;
  month: number;
  day: number;
}

interface LunisolarLimit {
  label: string;
  start: DateBoundary;
  end: DateBoundary;
  yearOffset: number;
}

interface DateFieldRefs {
  year: Ref<string>;
  month: Ref<string>;
  day: Ref<string>;
}

type ParsedSolarState =
  | { ok: true; solar: Solar }
  | { ok: false; issue: ParseIssue };

interface GanzhiResult {
  solarLabel: string;
  lunarLabel: string;
  yearPillar: string;
  monthPillar: string;
  dayPillar: string;
  timePillar: string;
  zodiac: string;
  zodiacEmoji: string;
}

interface LunisolarModeState {
  limit: LunisolarLimit;
  refs: DateFieldRefs;
  monthOptions: ComputedRef<SelectOption[]>;
  dayOptions: ComputedRef<SelectOption[]>;
  yearError: ComputedRef<string | undefined>;
}

const MIN_SOLAR_YEAR = 1;
const MAX_SOLAR_YEAR = 9999;
// `lunar-javascript` 在这页实际覆盖的边界范围：
// - 公历：0001-01-01 ~ 9999-12-31
// - 农历：0 年 11 月 18 日 ~ 9999 年 12 月 2 日
// - 佛历：544 年 11 月 18 日 ~ 10543 年 12 月 2 日
// - 道历：2697 年 11 月 18 日 ~ 12696 年 12 月 2 日
// 参考本地库测试与 6tail FAQ：
// https://6tail.cn/calendar/api.html#faq.html
const LUNISOLAR_LIMITS = {
  lunar: { label: "农历日期", start: { year: 0, month: 11, day: 18 }, end: { year: 9999, month: 12, day: 2 }, yearOffset: 0 },
  foto: { label: "佛历日期", start: { year: 544, month: 11, day: 18 }, end: { year: 10543, month: 12, day: 2 }, yearOffset: 544 },
  tao: { label: "道历日期", start: { year: 2697, month: 11, day: 18 }, end: { year: 12696, month: 12, day: 2 }, yearOffset: 2697 },
} as const satisfies Record<LunisolarMode, LunisolarLimit>;
const monthNames = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"] as const;
const dayNames = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
] as const;
const solarMonthOptions = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1;
  return { value: String(month), label: `${String(month).padStart(2, "0")}月` } satisfies SelectOption;
});
const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: formatHourLabel(hour),
})) satisfies SelectOption[];

const zodiacEmojiMap = {
  鼠: "🐭",
  牛: "🐮",
  虎: "🐯",
  兔: "🐰",
  龙: "🐲",
  蛇: "🐍",
  马: "🐴",
  羊: "🐏",
  猴: "🐵",
  鸡: "🐔",
  狗: "🐶",
  猪: "🐷",
} as const satisfies Record<string, string>;

const today = new Date();
const currentHour = today.getHours();
const todaySolar = Solar.fromYmdHms(today.getFullYear(), today.getMonth() + 1, today.getDate(), currentHour, 0, 0);
const todayLunar = todaySolar.getLunar();
const todayFoto = Foto.fromLunar(todayLunar);
const todayTao = Tao.fromLunar(todayLunar);

const calendarMode = ref<CalendarMode>("solar");
const yearType = ref<YearType>("0");
const dayType = ref<DayType>("0");
const hour = ref(String(currentHour));

const solarYear = ref(String(today.getFullYear()));
const solarMonth = ref(String(today.getMonth() + 1));
const solarDay = ref(String(today.getDate()));

const lunarYear = ref(String(todayLunar.getYear()));
const lunarMonth = ref(String(todayLunar.getMonth()));
const lunarDay = ref(String(todayLunar.getDay()));

const fotoYear = ref(String(todayFoto.getYear()));
const fotoMonth = ref(String(todayFoto.getMonth()));
const fotoDay = ref(String(todayFoto.getDay()));

const taoYear = ref(String(todayTao.getYear()));
const taoMonth = ref(String(todayTao.getMonth()));
const taoDay = ref(String(todayTao.getDay()));

const solarRefs = { year: solarYear, month: solarMonth, day: solarDay } as const satisfies DateFieldRefs;
const lunisolarRefsMap = {
  lunar: { year: lunarYear, month: lunarMonth, day: lunarDay },
  foto: { year: fotoYear, month: fotoMonth, day: fotoDay },
  tao: { year: taoYear, month: taoMonth, day: taoDay },
} as const satisfies Record<LunisolarMode, DateFieldRefs>;

const solarDayOptions = computed(() => {
  const year = Number.parseInt(solarYear.value, 10);
  const month = Number.parseInt(solarMonth.value, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return [];
  }

  return createSolarDayOptions(year, month);
});

const lunarMonthOptions = computed(() => createLunisolarMonthOptions("lunar", lunarYear.value));
const fotoMonthOptions = computed(() => createLunisolarMonthOptions("foto", fotoYear.value));
const taoMonthOptions = computed(() => createLunisolarMonthOptions("tao", taoYear.value));

const lunarDayOptions = computed(() => createLunisolarDayOptions("lunar", lunarYear.value, lunarMonth.value));
const fotoDayOptions = computed(() => createLunisolarDayOptions("foto", fotoYear.value, fotoMonth.value));
const taoDayOptions = computed(() => createLunisolarDayOptions("tao", taoYear.value, taoMonth.value));

const solarYearError = computed(() => getYearRangeError(solarYear.value, MIN_SOLAR_YEAR, MAX_SOLAR_YEAR));
const lunarYearError = computed(() => getYearRangeError(lunarYear.value, LUNISOLAR_LIMITS.lunar.start.year, LUNISOLAR_LIMITS.lunar.end.year));
const fotoYearError = computed(() => getYearRangeError(fotoYear.value, LUNISOLAR_LIMITS.foto.start.year, LUNISOLAR_LIMITS.foto.end.year));
const taoYearError = computed(() => getYearRangeError(taoYear.value, LUNISOLAR_LIMITS.tao.start.year, LUNISOLAR_LIMITS.tao.end.year));

const lunisolarModeState = {
  lunar: {
    limit: LUNISOLAR_LIMITS.lunar,
    refs: lunisolarRefsMap.lunar,
    monthOptions: lunarMonthOptions,
    dayOptions: lunarDayOptions,
    yearError: lunarYearError,
  },
  foto: {
    limit: LUNISOLAR_LIMITS.foto,
    refs: lunisolarRefsMap.foto,
    monthOptions: fotoMonthOptions,
    dayOptions: fotoDayOptions,
    yearError: fotoYearError,
  },
  tao: {
    limit: LUNISOLAR_LIMITS.tao,
    refs: lunisolarRefsMap.tao,
    monthOptions: taoMonthOptions,
    dayOptions: taoDayOptions,
    yearError: taoYearError,
  },
} as const satisfies Record<LunisolarMode, LunisolarModeState>;

const activeParsedSolar = computed(() => (
  calendarMode.value === "solar" ? parseSolarInput() : parseLunisolarInput(calendarMode.value)
));
const lastValidSolar = ref(todaySolar);
const copyStatus = ref<"idle" | "success" | "error">("idle");
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
const activeLunisolarState = computed(() => (
  calendarMode.value === "solar" ? undefined : lunisolarModeState[calendarMode.value]
));

const activeError = computed(() => {
  if (activeParsedSolar.value.ok) {
    return undefined;
  }

  if (activeParsedSolar.value.issue === "year-range") {
    return calendarMode.value === "solar" ? solarYearError.value : activeLunisolarState.value?.yearError.value;
  }

  return "请输入合法日期";
});

const activeLunisolarLabel = computed(() => activeLunisolarState.value?.limit.label ?? "");
const activeLunisolarYearText = computed(() => activeLunisolarState.value?.refs.year.value ?? "");
const activeLunisolarYearError = computed(() => activeLunisolarState.value?.yearError.value);
const activeLunisolarYearMaxLength = computed(() => activeLunisolarState.value ? String(activeLunisolarState.value.limit.end.year).length : 4);
const activeLunisolarMonthOptions = computed(() => calendarMode.value === "solar"
  ? []
  : activeLunisolarState.value?.monthOptions.value ?? []);
const activeLunisolarDayOptions = computed(() => calendarMode.value === "solar"
  ? []
  : activeLunisolarState.value?.dayOptions.value ?? []);
const activeLunisolarMonth = computed({
  get() {
    return activeLunisolarState.value?.refs.month.value ?? "";
  },
  set(value: string) {
    if (activeLunisolarState.value) {
      activeLunisolarState.value.refs.month.value = value;
    }
  },
});
const activeLunisolarDay = computed({
  get() {
    return activeLunisolarState.value?.refs.day.value ?? "";
  },
  set(value: string) {
    if (activeLunisolarState.value) {
      activeLunisolarState.value.refs.day.value = value;
    }
  },
});
const activeLeapMonthHint = computed(() => {
  if (!activeLunisolarState.value) {
    return undefined;
  }

  const { limit, refs } = activeLunisolarState.value;
  const displayYear = parseYearInRange(
    refs.year.value,
    limit.start.year,
    limit.end.year,
  );
  if (!Number.isInteger(displayYear)) {
    return undefined;
  }

  try {
    const leapMonth = LunarYear.fromYear(toLunarYear(calendarMode.value, displayYear)).getLeapMonth();
    return leapMonth > 0 ? `该年闰 ${leapMonth} 月` : "该年无闰月";
  } catch {
    return undefined;
  }
});

const result = computed<GanzhiResult | undefined>(() => {
  if (!activeParsedSolar.value.ok) {
    return undefined;
  }

  const { solar } = activeParsedSolar.value;
  const lunar = solar.getLunar();
  const zodiac = yearType.value === "0" ? lunar.getYearShengXiao() : lunar.getYearShengXiaoByLiChun();
  return {
    solarLabel: solar.toYmd(),
    lunarLabel: lunar.toString(),
    yearPillar: yearType.value === "0" ? lunar.getYearInGanZhi() : lunar.getYearInGanZhiByLiChun(),
    monthPillar: lunar.getMonthInGanZhi(),
    dayPillar: dayType.value === "0" ? lunar.getDayInGanZhiExact() : lunar.getDayInGanZhiExact2(),
    timePillar: lunar.getTimeInGanZhi(),
    zodiac,
    zodiacEmoji: zodiacEmojiMap[zodiac] ?? "",
  };
});
const resultCopyText = computed(() => {
  if (!result.value) {
    return "";
  }

  return [
    `年柱 ${result.value.yearPillar}`,
    `月柱 ${result.value.monthPillar}`,
    `日柱 ${result.value.dayPillar}`,
    `时柱 ${result.value.timePillar}`,
    `公历 ${result.value.solarLabel}`,
    `农历 ${result.value.lunarLabel}`,
    `生肖 ${result.value.zodiac}${result.value.zodiacEmoji ? ` ${result.value.zodiacEmoji}` : ""}`,
  ].join("\n");
});
const copyButtonIcon = computed(() => {
  if (copyStatus.value === "success") {
    return "✓";
  }
  if (copyStatus.value === "error") {
    return "!";
  }
  return "⧉";
});
const copyButtonText = computed(() => {
  if (copyStatus.value === "success") {
    return "已复制";
  }
  if (copyStatus.value === "error") {
    return "复制失败";
  }
  return "复制";
});
const copyStatusAnnouncement = computed(() => {
  if (copyStatus.value === "success") {
    return "结果已复制到剪贴板";
  }
  if (copyStatus.value === "error") {
    return "复制失败，请手动复制";
  }
  return "";
});

watch(activeParsedSolar, (state) => {
  if (state.ok) {
    lastValidSolar.value = state.solar;
  }
}, { immediate: true });

watch([solarRefs.year, solarRefs.month, solarDayOptions], () => {
  clampSelectedValue(solarRefs.day, solarDayOptions.value);
});

for (const mode of LUNISOLAR_MODES) {
  registerLunisolarOptionSync(mode);
}

watch(calendarMode, (mode, previousMode) => {
  if (mode === previousMode) {
    return;
  }

  const previousParsedState = previousMode === "solar" ? parseSolarInput() : parseLunisolarInput(previousMode);
  const solar = previousParsedState.ok ? previousParsedState.solar : lastValidSolar.value;

  if (mode === "solar") {
    syncSolarInputs(solar);
    return;
  }

  syncLunisolarInputs(mode, solar.getLunar());
});

onBeforeUnmount(() => {
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }
});

async function copyResult() {
  if (!resultCopyText.value) {
    return;
  }

  try {
    await copyText(resultCopyText.value);
    setCopyStatus("success");
  } catch {
    setCopyStatus("error");
  }
}

function setCopyStatus(status: "idle" | "success" | "error") {
  copyStatus.value = status;
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }

  if (status !== "idle") {
    copyStatusTimer = setTimeout(() => {
      copyStatus.value = "idle";
      copyStatusTimer = undefined;
    }, 2000);
  }
}

function parseSolarInput(): ParsedSolarState {
  const year = parseYearInRange(solarYear.value, MIN_SOLAR_YEAR, MAX_SOLAR_YEAR);
  if (!Number.isInteger(year)) {
    return { ok: false, issue: "year-range" };
  }

  const month = Number.parseInt(solarMonth.value, 10);
  const day = Number.parseInt(solarDay.value, 10);
  const selectedHour = Number.parseInt(hour.value, 10);
  if (![year, month, day, selectedHour].every(Number.isInteger)) {
    return { ok: false, issue: "invalid-date" };
  }

  try {
    const solar = Solar.fromYmdHms(year, month, day, selectedHour, 0, 0);
    return solar.toYmd() === formatSolarYmd(year, month, day) ? { ok: true, solar } : { ok: false, issue: "invalid-date" };
  } catch {
    return { ok: false, issue: "invalid-date" };
  }
}

function parseLunisolarInput(mode: LunisolarMode): ParsedSolarState {
  const { limit, refs } = lunisolarModeState[mode];
  const year = parseYearInRange(refs.year.value, limit.start.year, limit.end.year);
  if (!Number.isInteger(year)) {
    return { ok: false, issue: "year-range" };
  }

  const month = Number.parseInt(refs.month.value.trim(), 10);
  const day = Number.parseInt(refs.day.value.trim(), 10);
  const selectedHour = Number.parseInt(hour.value, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(selectedHour)) {
    return { ok: false, issue: "invalid-date" };
  }

  if (Math.abs(month) < 1 || Math.abs(month) > 12 || day < 1 || day > 30) {
    return { ok: false, issue: "invalid-date" };
  }

  if (!isWithinSupportedLunisolarDateRange(mode, year, month, day)) {
    return { ok: false, issue: "invalid-date" };
  }

  try {
    return { ok: true, solar: Lunar.fromYmdHms(toLunarYear(mode, year), month, day, selectedHour, 0, 0).getSolar() };
  } catch {
    return { ok: false, issue: "invalid-date" };
  }
}

function syncSolarInputs(solar: { getYear(): number; getMonth(): number; getDay(): number }) {
  solarYear.value = String(solar.getYear());
  solarMonth.value = String(solar.getMonth());
  solarDay.value = String(solar.getDay());
}

function syncLunisolarInputs(mode: LunisolarMode, lunar: { getYear(): number; getMonth(): number; getDay(): number }) {
  const { refs } = lunisolarModeState[mode];
  refs.year.value = String(fromLunarYear(mode, lunar.getYear()));
  refs.month.value = String(lunar.getMonth());
  refs.day.value = String(lunar.getDay());
}

function createSolarDayOptions(year: number, month: number): SelectOption[] {
  const options: SelectOption[] = [];
  for (let day = 1; day <= 31; day++) {
    if (isValidSolarDate(year, month, day)) {
      options.push({
        value: String(day),
        label: `${String(day).padStart(2, "0")}日`,
      });
    }
  }
  return options;
}

function createLunisolarMonthOptions(mode: LunisolarMode, yearText: string): SelectOption[] {
  const limits = LUNISOLAR_LIMITS[mode];
  const year = parseYearInRange(yearText, limits.start.year, limits.end.year);
  if (!Number.isInteger(year)) {
    return [];
  }

  try {
    const leapMonth = LunarYear.fromYear(toLunarYear(mode, year)).getLeapMonth();
    const options: SelectOption[] = [];
    for (let month = 1; month <= 12; month++) {
      if (isWithinSupportedLunisolarMonthRange(mode, year, month)) {
        options.push({
          value: String(month),
          label: `${monthNames[month - 1]}月`,
        });
      }
      if (month === leapMonth && isWithinSupportedLunisolarMonthRange(mode, year, -month)) {
        options.push({
          value: String(-month),
          label: `闰${monthNames[month - 1]}`,
        });
      }
    }
    return options;
  } catch {
    return [];
  }
}

function createLunisolarDayOptions(mode: LunisolarMode, yearText: string, monthText: string): SelectOption[] {
  const limits = LUNISOLAR_LIMITS[mode];
  const year = parseYearInRange(yearText, limits.start.year, limits.end.year);
  const month = Number.parseInt(monthText, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month === 0) {
    return [];
  }

  try {
    const dayCount = LunarMonth.fromYm(toLunarYear(mode, year), month).getDayCount();
    return Array.from({ length: dayCount }, (_, index) => index + 1)
      .filter((day) => isWithinSupportedLunisolarDateRange(mode, year, month, day))
      .map((day) => ({
        value: String(day),
        label: dayNames[day - 1],
      }));
  } catch {
    return [];
  }
}

function isWithinSupportedLunisolarMonthRange(mode: LunisolarMode, year: number, month: number) {
  const limits = LUNISOLAR_LIMITS[mode];
  const normalizedMonth = Math.abs(month);
  if (year < limits.start.year || year > limits.end.year) {
    return false;
  }
  if (year === limits.start.year && normalizedMonth < limits.start.month) {
    return false;
  }
  if (year === limits.end.year && normalizedMonth > limits.end.month) {
    return false;
  }
  return true;
}

function isWithinSupportedLunisolarDateRange(mode: LunisolarMode, year: number, month: number, day: number) {
  const limits = LUNISOLAR_LIMITS[mode];
  const normalizedMonth = Math.abs(month);
  if (!isWithinSupportedLunisolarMonthRange(mode, year, month)) {
    return false;
  }
  if (compareDateBoundary({ year, month: normalizedMonth, day }, limits.start) < 0) {
    return false;
  }
  if (compareDateBoundary({ year, month: normalizedMonth, day }, limits.end) > 0) {
    return false;
  }
  return true;
}

function compareDateBoundary(left: DateBoundary, right: DateBoundary) {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

function isValidSolarDate(year: number, month: number, day: number) {
  // 参考 6tail 官方 FAQ：1582-10-05 至 1582-10-14 在格里历中不存在。
  // https://6tail.cn/calendar/api.html#faq.html
  try {
    const solar = Solar.fromYmdHms(year, month, day, 0, 0, 0);
    return solar.toYmd() === formatSolarYmd(year, month, day);
  } catch {
    return false;
  }
}

function formatSolarYmd(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function clampSelectedValue(target: { value: string }, options: SelectOption[]) {
  if (!options.length) {
    target.value = "";
    return;
  }

  if (!options.some((option) => option.value === target.value)) {
    target.value = findClosestOptionValue(target.value, options) ?? options[0].value;
  }
}

function findClosestOptionValue(currentValue: string, options: SelectOption[]) {
  const currentNumber = Number.parseInt(currentValue, 10);
  if (!Number.isInteger(currentNumber)) {
    return undefined;
  }

  let closestValue: string | undefined;
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const optionNumber = Number.parseInt(option.value, 10);
    if (!Number.isInteger(optionNumber)) {
      continue;
    }

    const distance = Math.abs(optionNumber - currentNumber);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      closestValue = option.value;
    }
  }
  return closestValue;
}

function parseYearInRange(value: string, minYear: number, maxYear: number) {
  const yearText = value.trim();
  if (!/^\d+$/.test(yearText)) {
    return undefined;
  }

  const year = Number.parseInt(yearText, 10);
  return year >= minYear && year <= maxYear ? year : undefined;
}

function getYearRangeError(value: string, minYear: number, maxYear: number) {
  if (value === "") {
    return undefined;
  }

  const year = parseYearInRange(value, minYear, maxYear);
  return year === undefined ? `年份范围：${minYear}-${maxYear}` : undefined;
}

function normalizeYearInput(value: string, maxLength: number) {
  return value.replace(/\D+/g, "").slice(0, maxLength);
}

function getYearModel(mode: CalendarMode) {
  if (mode === "solar") {
    return { target: solarRefs.year, minYear: MIN_SOLAR_YEAR, maxYear: MAX_SOLAR_YEAR, maxLength: 4 };
  }

  const { refs, limit } = lunisolarModeState[mode];
  return { target: refs.year, minYear: limit.start.year, maxYear: limit.end.year, maxLength: String(limit.end.year).length };
}

function updateYearValue(mode: CalendarMode, value: string) {
  const { target, maxLength } = getYearModel(mode);
  target.value = normalizeYearInput(value, maxLength);
}

function stepYear(mode: CalendarMode, delta: number) {
  const { target, minYear, maxYear } = getYearModel(mode);
  const currentYear = parseYearInRange(target.value, minYear, maxYear);
  const baseYear = currentYear ?? minYear;
  const nextYear = Math.min(Math.max(baseYear + delta, minYear), maxYear);
  target.value = String(nextYear);
}

function handleYearInput(event: Event, mode: CalendarMode) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const { maxLength } = getYearModel(mode);
  const normalizedValue = normalizeYearInput(input.value, maxLength);
  input.value = normalizedValue;
  updateYearValue(mode, normalizedValue);
}

function handleYearWheel(event: WheelEvent, mode: CalendarMode) {
  if (event.deltaY === 0) {
    return;
  }

  stepYear(mode, event.deltaY > 0 ? 1 : -1);
}

function handleSelectWheel(event: WheelEvent) {
  if (event.deltaY === 0) {
    return;
  }

  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement) || select.options.length === 0) {
    return;
  }

  const fallbackIndex = select.selectedIndex >= 0 ? select.selectedIndex : 0;
  const direction = event.deltaY > 0 ? 1 : -1;
  const nextIndex = Math.min(Math.max(fallbackIndex + direction, 0), select.options.length - 1);

  if (nextIndex !== fallbackIndex) {
    select.selectedIndex = nextIndex;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function toLunarYear(mode: LunisolarMode, displayYear: number) {
  return displayYear - LUNISOLAR_LIMITS[mode].yearOffset;
}

function fromLunarYear(mode: LunisolarMode, lunarYear: number) {
  return lunarYear + LUNISOLAR_LIMITS[mode].yearOffset;
}

function formatHourLabel(hourValue: number): string {
  const start = `${String(hourValue).padStart(2, "0")}:00`;
  const end = `${String(hourValue).padStart(2, "0")}:59`;
  if (hourValue === 0) {
    return `${start}-${end}（早子）`;
  }
  if (hourValue === 23) {
    return `${start}-${end}（晚子）`;
  }

  const zhiLabels = ["丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
  const index = Math.floor((hourValue - 1) / 2);
  return `${start}-${end}（${zhiLabels[index]}时）`;
}

function registerLunisolarOptionSync(mode: LunisolarMode) {
  const { refs, monthOptions, dayOptions } = lunisolarModeState[mode];

  watch([refs.year, monthOptions], () => {
    clampSelectedValue(refs.month, monthOptions.value);
  });

  watch([refs.year, refs.month, dayOptions], () => {
    clampSelectedValue(refs.day, dayOptions.value);
  });
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Copy failed");
  }
}
</script>
<!-- autocorrect-enable -->

选择公历、农历、佛历或道历日期，快速查看对应的年柱、月柱、日柱、时柱。

可在年份框和下拉框上滚动滚轮快速切换。

<div class="ganzhi-tool">
  <div class="ganzhi-tool__mode">
    <button
      :class="{ 'ganzhi-tool__mode-button--active': calendarMode === 'solar' }"
      type="button"
      @click="calendarMode = 'solar'"
    >
      公历
    </button>
    <button
      :class="{ 'ganzhi-tool__mode-button--active': calendarMode === 'lunar' }"
      type="button"
      @click="calendarMode = 'lunar'"
    >
      农历
    </button>
    <button
      :class="{ 'ganzhi-tool__mode-button--active': calendarMode === 'foto' }"
      type="button"
      @click="calendarMode = 'foto'"
    >
      佛历
    </button>
    <button
      :class="{ 'ganzhi-tool__mode-button--active': calendarMode === 'tao' }"
      type="button"
      @click="calendarMode = 'tao'"
    >
      道历
    </button>
  </div>
  <template v-if="calendarMode === 'solar'">
    <label>公历日期</label>
    <div class="ganzhi-tool__select-grid">
      <div class="ganzhi-tool__year-field">
        <div class="ganzhi-tool__year-stepper">
          <button
            type="button"
            aria-label="公历年份减一"
            @click="stepYear('solar', -1)"
          >
            -
          </button>
          <input
            :value="solarYear"
            maxlength="4"
            inputmode="numeric"
            aria-label="公历年份"
            :aria-invalid="Boolean(solarYearError)"
            @input="handleYearInput($event, 'solar')"
            @wheel.prevent="handleYearWheel($event, 'solar')"
          >
          <button
            type="button"
            aria-label="公历年份加一"
            @click="stepYear('solar', 1)"
          >
            +
          </button>
        </div>
      </div>
      <select
        v-model="solarMonth"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in solarMonthOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <select
        v-model="solarDay"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in solarDayOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>
  </template>
  <template v-else>
    <div class="ganzhi-tool__label-row">
      <label>{{ activeLunisolarLabel }}</label>
      <span
        v-if="activeLeapMonthHint"
        class="ganzhi-tool__hint"
      >
        {{ activeLeapMonthHint }}
      </span>
    </div>
    <div class="ganzhi-tool__select-grid">
      <div class="ganzhi-tool__year-field">
        <div class="ganzhi-tool__year-stepper">
          <button
            type="button"
            :aria-label="`${activeLunisolarLabel}减一`"
            @click="stepYear(calendarMode, -1)"
          >
            -
          </button>
          <input
            :value="activeLunisolarYearText"
            :maxlength="activeLunisolarYearMaxLength"
            inputmode="numeric"
            :aria-label="activeLunisolarLabel"
            :aria-invalid="Boolean(activeLunisolarYearError)"
            @input="handleYearInput($event, calendarMode)"
            @wheel.prevent="handleYearWheel($event, calendarMode)"
          >
          <button
            type="button"
            :aria-label="`${activeLunisolarLabel}加一`"
            @click="stepYear(calendarMode, 1)"
          >
            +
          </button>
        </div>
      </div>
      <select
        v-model="activeLunisolarMonth"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in activeLunisolarMonthOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <select
        v-model="activeLunisolarDay"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in activeLunisolarDayOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>
  </template>
  <div class="ganzhi-tool__compact-grid">
    <div class="ganzhi-tool__field">
      <label>选择时辰</label>
      <select
        v-model="hour"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in hourOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>
    <div class="ganzhi-tool__field">
      <label>年计算方式</label>
      <select
        v-model="yearType"
        @wheel.prevent="handleSelectWheel"
      >
        <option value="0">正月初一起算</option>
        <option value="1">立春零点起算</option>
      </select>
    </div>
    <div class="ganzhi-tool__field">
      <label>日计算方式</label>
      <select
        v-model="dayType"
        @wheel.prevent="handleSelectWheel"
      >
        <option value="0">晚子时算明天</option>
        <option value="1">晚子时算当天</option>
      </select>
    </div>
  </div>
  <div class="ganzhi-tool__label-row">
    <label>结果</label>
    <button
      v-if="result"
      type="button"
      class="ganzhi-tool__copy-button"
      :class="{
        'ganzhi-tool__copy-button--success': copyStatus === 'success',
        'ganzhi-tool__copy-button--error': copyStatus === 'error',
      }"
      :aria-label="copyStatus === 'success' ? '结果已复制' : '复制结果'"
      @click="copyResult"
    >
      <span
        class="ganzhi-tool__copy-icon"
        aria-hidden="true"
      >
        {{ copyButtonIcon }}
      </span>
      <span>{{ copyButtonText }}</span>
    </button>
  </div>
  <div
    v-if="result"
    class="ganzhi-tool__result"
  >
    <p
      class="ganzhi-tool__sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ copyStatusAnnouncement }}
    </p>
    <div class="ganzhi-tool__pillar-grid">
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">年柱</span>
        <strong class="ganzhi-tool__result-value">{{ result.yearPillar }}</strong>
      </div>
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">月柱</span>
        <strong class="ganzhi-tool__result-value">{{ result.monthPillar }}</strong>
      </div>
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">日柱</span>
        <strong class="ganzhi-tool__result-value">{{ result.dayPillar }}</strong>
      </div>
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">时柱</span>
        <strong class="ganzhi-tool__result-value">{{ result.timePillar }}</strong>
      </div>
    </div>
    <div class="ganzhi-tool__meta-grid">
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">公历</span>
        <strong class="ganzhi-tool__meta-value">{{ result.solarLabel }}</strong>
      </div>
      <div class="ganzhi-tool__result-item ganzhi-tool__result-item--wide">
        <span class="ganzhi-tool__result-label">农历</span>
        <strong class="ganzhi-tool__meta-value">{{ result.lunarLabel }}</strong>
      </div>
      <div class="ganzhi-tool__result-item">
        <span class="ganzhi-tool__result-label">生肖</span>
        <strong class="ganzhi-tool__meta-value">{{ result.zodiac }}{{ result.zodiacEmoji ? ` ${result.zodiacEmoji}` : "" }}</strong>
      </div>
    </div>
  </div>
  <p
    v-else
    class="ganzhi-tool__error"
  >
    {{ activeError }}
  </p>
</div>

## 名词解释

- 年柱：用天干地支表示的年份，如丙午年。
- 月柱：用天干地支表示的月份，如辛卯月。
- 日柱：用天干地支表示的日期，如丁未日。
- 时柱：用天干地支表示的时辰，如辛亥时。

## 说明

- 支持公历 / 农历 / 佛历 / 道历四种选择方式。
  - 公历范围：0001-01-01 至 9999-12-31
  - 农历范围：〇年冬月十八至九九九九年腊月初二
  - 佛历范围：544 年冬月十八至 10543 年腊月初二
  - 道历范围：2697 年冬月十八至 12696 年腊月初二
- 结果同时显示公历、农历和干支。
- 公历日期会过滤历史上不存在的日期，例如 1582 年 10 月 5 日至 14 日。
- 年计算方式支持正月初一起算和立春零点起算，影响年柱和生肖。
- 日计算方式支持晚子时算明天和晚子时算当天，影响日柱。
- 时柱按所选小时直接计算。
- 本页基于 [`lunar-javascript`](https://www.npmjs.com/package/lunar-javascript) 计算，感谢这个出色的开源项目。

<style scoped>
.ganzhi-tool {
  display: grid;
  gap: 12px;
  max-width: 720px;
  margin: 16px 0 24px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.ganzhi-tool label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
}

.ganzhi-tool select,
.ganzhi-tool input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.ganzhi-tool input[aria-invalid="true"] {
  border-color: var(--vp-c-danger-1);
}

.ganzhi-tool__mode {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ganzhi-tool__mode button {
  padding: 8px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.ganzhi-tool__mode-button--active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ganzhi-tool__select-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ganzhi-tool__compact-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ganzhi-tool__field {
  min-width: 0;
}

.ganzhi-tool__label-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.ganzhi-tool__year-field {
  min-width: 0;
}

.ganzhi-tool__year-stepper {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  gap: 6px;
}

.ganzhi-tool__year-stepper button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  cursor: pointer;
  font-size: 1rem;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
}

.ganzhi-tool__hint {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.ganzhi-tool__result {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--vp-c-bg) 97%, var(--vp-c-bg-soft) 3%);
  box-shadow: 0 8px 24px rgb(15 23 42 / 0.04);
}

.ganzhi-tool__result-kicker,
.ganzhi-tool__result-label {
  margin: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.ganzhi-tool__pillar-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.ganzhi-tool__meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 10px;
}

.ganzhi-tool__result-item {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 92%, transparent);
  border-radius: 10px;
  background: transparent;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease, color 0.22s ease;
}

.ganzhi-tool__result-item:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.06);
  transform: translateY(-1px);
}

.ganzhi-tool__result-value,
.ganzhi-tool__meta-value {
  line-height: 1.4;
  word-break: break-word;
}

.ganzhi-tool__result-value {
  font-size: 1.1rem;
  font-weight: 700;
}

.ganzhi-tool__meta-value {
  font-size: 0.98rem;
  font-weight: 600;
}

.ganzhi-tool__result-item--wide .ganzhi-tool__meta-value {
  white-space: nowrap;
}

.ganzhi-tool__copy-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
}

.ganzhi-tool__copy-button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.ganzhi-tool__copy-button--success {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ganzhi-tool__copy-button--error {
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 45%, var(--vp-c-divider));
  color: var(--vp-c-danger-1);
}

.ganzhi-tool__copy-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  font-size: 0.95rem;
  font-weight: 700;
}

.ganzhi-tool__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ganzhi-tool button:focus-visible,
.ganzhi-tool select:focus-visible,
.ganzhi-tool input:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

.ganzhi-tool__mode button:hover,
.ganzhi-tool__year-stepper button:hover {
  transform: translateY(-1px);
  border-color: var(--vp-c-brand-1);
}

.ganzhi-tool__error {
  margin: 0;
  color: var(--vp-c-danger-1);
}

@media (max-width: 640px) {
  .ganzhi-tool__label-row,
  .ganzhi-tool__select-grid,
  .ganzhi-tool__compact-grid {
    display: grid;
  }

  .ganzhi-tool__label-row {
    gap: 4px;
  }

  .ganzhi-tool__hint {
    white-space: normal;
  }

  .ganzhi-tool__pillar-grid,
  .ganzhi-tool__meta-grid,
  .ganzhi-tool__select-grid,
  .ganzhi-tool__compact-grid {
    grid-template-columns: 1fr;
  }
}
</style>
