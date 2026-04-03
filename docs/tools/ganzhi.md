---
publish: false
published: 2026-04-03T20:00:00+08:00
---

# 天干地支年月日计算器

<script setup lang="ts">
import { Lunar, LunarMonth, LunarYear, Solar } from "lunar-javascript";
import { computed, ref, watch } from "vue";

type CalendarMode = "solar" | "lunar";
type YearType = "0" | "1";
type DayType = "0" | "1";
type YearInputKind = "solar" | "lunar";

interface SelectOption {
  label: string;
  value: string;
}

// `lunar-javascript` 在这页实际覆盖的边界范围：
// - 公历：0001-01-01 ~ 9999-12-31
// - 农历：0年11月18日 ~ 9999年12月2日
// 参考本地库测试与 6tail FAQ：
// https://6tail.cn/calendar/api.html#faq.html
const MIN_SOLAR_YEAR = 1;
const MIN_LUNAR_YEAR = 0;
const MAX_YEAR = 9999;
const MIN_LUNAR_MONTH = 11;
const MIN_LUNAR_DAY = 18;
const MAX_LUNAR_MONTH = 12;
const MAX_LUNAR_DAY = 2;
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

const today = new Date();
const currentHour = today.getHours();
const todaySolar = Solar.fromYmdHms(today.getFullYear(), today.getMonth() + 1, today.getDate(), currentHour, 0, 0);
const todayLunar = todaySolar.getLunar();

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

const solarDayOptions = computed(() => {
  const year = Number.parseInt(solarYear.value, 10);
  const month = Number.parseInt(solarMonth.value, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return [];
  }

  return createSolarDayOptions(year, month);
});

const lunarMonthOptions = computed(() => {
  const year = Number.parseInt(lunarYear.value, 10);
  if (!Number.isInteger(year)) {
    return [];
  }

  try {
    const leapMonth = LunarYear.fromYear(year).getLeapMonth();
    const options: SelectOption[] = [];
    for (let month = 1; month <= 12; month++) {
      if (isWithinSupportedLunarMonthRange(year, month)) {
        options.push({
          value: String(month),
          label: `${monthNames[month - 1]}月`,
        });
      }
      if (month === leapMonth && isWithinSupportedLunarMonthRange(year, -month)) {
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
});

const lunarDayOptions = computed(() => {
  const year = Number.parseInt(lunarYear.value, 10);
  const month = Number.parseInt(lunarMonth.value, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month === 0) {
    return [];
  }

  try {
    const dayCount = LunarMonth.fromYm(year, month).getDayCount();
    return Array.from({ length: dayCount }, (_, index) => index + 1)
      .filter((day) => isWithinSupportedLunarDateRange(year, month, day))
      .map((day) => ({
        value: String(day),
        label: dayNames[day - 1],
      }));
  } catch {
    return [];
  }
});

const solarYearError = computed(() => getYearRangeError(solarYear.value, MIN_SOLAR_YEAR));
const lunarYearError = computed(() => getYearRangeError(lunarYear.value, MIN_LUNAR_YEAR));
const activeError = computed(() => {
  const yearError = calendarMode.value === "solar" ? solarYearError.value : lunarYearError.value;
  if (yearError) {
    return yearError;
  }

  return "请输入合法日期";
});

const leapMonthHint = computed(() => {
  const year = Number.parseInt(lunarYear.value, 10);
  if (!Number.isInteger(year)) {
    return undefined;
  }

  try {
    const leapMonth = LunarYear.fromYear(year).getLeapMonth();
    return leapMonth > 0 ? `该年闰 ${leapMonth} 月` : "该年无闰月";
  } catch {
    return undefined;
  }
});

const result = computed(() => {
  try {
    const solar = calendarMode.value === "solar" ? parseSolarInput() : parseLunarInput();
    if (!solar) {
      return undefined;
    }

    const lunar = solar.getLunar();
    return {
      solarLabel: solar.toYmd(),
      lunarLabel: lunar.toString(),
      yearPillar: yearType.value === "0" ? lunar.getYearInGanZhi() : lunar.getYearInGanZhiByLiChun(),
      monthPillar: lunar.getMonthInGanZhi(),
      dayPillar: dayType.value === "0" ? lunar.getDayInGanZhiExact() : lunar.getDayInGanZhiExact2(),
      timePillar: lunar.getTimeInGanZhi(),
      zodiac: yearType.value === "0" ? lunar.getYearShengXiao() : lunar.getYearShengXiaoByLiChun(),
    };
  } catch {
    return undefined;
  }
});

watch([solarYear, solarMonth, solarDayOptions], () => {
  clampSelectedValue(solarDay, solarDayOptions.value);
});

watch([lunarYear, lunarMonthOptions], () => {
  clampSelectedValue(lunarMonth, lunarMonthOptions.value);
});

watch([lunarYear, lunarMonth, lunarDayOptions], () => {
  clampSelectedValue(lunarDay, lunarDayOptions.value);
});

watch(calendarMode, (mode, previousMode) => {
  if (mode === previousMode) {
    return;
  }

  if (mode === "lunar") {
    const solar = parseSolarInput();
    if (solar) {
      syncLunarInputs(solar.getLunar());
    }
    return;
  }

  const solar = parseLunarInput();
  if (solar) {
    syncSolarInputs(solar);
  }
});

function parseSolarInput() {
  const year = parseYearInRange(solarYear.value, MIN_SOLAR_YEAR);
  const month = Number.parseInt(solarMonth.value, 10);
  const day = Number.parseInt(solarDay.value, 10);
  const selectedHour = Number.parseInt(hour.value, 10);
  if (![year, month, day, selectedHour].every(Number.isInteger)) {
    return undefined;
  }

  const solar = Solar.fromYmdHms(year, month, day, selectedHour, 0, 0);
  return solar.toYmd() === formatSolarYmd(year, month, day) ? solar : undefined;
}

function parseLunarInput() {
  const year = parseYearInRange(lunarYear.value, MIN_LUNAR_YEAR);
  const month = Number.parseInt(lunarMonth.value.trim(), 10);
  const day = Number.parseInt(lunarDay.value.trim(), 10);
  const selectedHour = Number.parseInt(hour.value, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(selectedHour)) {
    return undefined;
  }

  if (Math.abs(month) < 1 || Math.abs(month) > 12 || day < 1 || day > 30) {
    return undefined;
  }

  return Lunar.fromYmdHms(year, month, day, selectedHour, 0, 0).getSolar();
}

function syncSolarInputs(solar: Solar) {
  solarYear.value = String(solar.getYear());
  solarMonth.value = String(solar.getMonth());
  solarDay.value = String(solar.getDay());
}

function syncLunarInputs(lunar: Lunar) {
  lunarYear.value = String(lunar.getYear());
  lunarMonth.value = String(lunar.getMonth());
  lunarDay.value = String(lunar.getDay());
}

function createDayOptions(dayCount: number, formatLabel: (day: number) => string): SelectOption[] {
  return Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    return {
      value: String(day),
      label: formatLabel(day),
    };
  });
}

function isWithinSupportedLunarMonthRange(year: number, month: number) {
  const normalizedMonth = Math.abs(month);
  if (year < MIN_LUNAR_YEAR || year > MAX_YEAR) {
    return false;
  }
  if (year === MIN_LUNAR_YEAR && normalizedMonth < MIN_LUNAR_MONTH) {
    return false;
  }
  if (year === MAX_YEAR && normalizedMonth > MAX_LUNAR_MONTH) {
    return false;
  }
  return true;
}

function isWithinSupportedLunarDateRange(year: number, month: number, day: number) {
  const normalizedMonth = Math.abs(month);
  if (!isWithinSupportedLunarMonthRange(year, month)) {
    return false;
  }
  if (year === MIN_LUNAR_YEAR && normalizedMonth === MIN_LUNAR_MONTH && day < MIN_LUNAR_DAY) {
    return false;
  }
  if (year === MAX_YEAR && normalizedMonth === MAX_LUNAR_MONTH && day > MAX_LUNAR_DAY) {
    return false;
  }
  return true;
}

function createSolarDayOptions(year: number, month: number): SelectOption[] {
  const dayCount = new Date(year, month, 0).getDate();
  const options: SelectOption[] = [];

  for (let day = 1; day <= dayCount; day++) {
    if (isValidSolarDate(year, month, day)) {
      options.push({
        value: String(day),
        label: `${String(day).padStart(2, "0")}日`,
      });
    }
  }

  return options;
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
    return;
  }

  if (!options.some((option) => option.value === target.value)) {
    target.value = options[0].value;
  }
}

function parseYearInRange(value: string, minYear: number) {
  const yearText = value.trim();
  if (!/^\d+$/.test(yearText)) {
    return undefined;
  }

  const year = Number.parseInt(yearText, 10);
  return year >= minYear && year <= MAX_YEAR ? year : undefined;
}

function getYearRangeError(value: string, minYear: number) {
  if (value === "") {
    return undefined;
  }

  const year = parseYearInRange(value, minYear);
  return year === undefined ? `年份范围：${minYear}-${MAX_YEAR}` : undefined;
}

function normalizeYearInput(value: string) {
  return value.replace(/\D+/g, "").slice(0, 4);
}

function getYearModel(kind: YearInputKind) {
  return kind === "solar"
    ? { target: solarYear, minYear: MIN_SOLAR_YEAR }
    : { target: lunarYear, minYear: MIN_LUNAR_YEAR };
}

function updateYearValue(kind: YearInputKind, value: string) {
  const { target } = getYearModel(kind);
  target.value = normalizeYearInput(value);
}

function stepYear(kind: YearInputKind, delta: number) {
  const { target, minYear } = getYearModel(kind);
  const currentYear = parseYearInRange(target.value, minYear);
  const baseYear = currentYear ?? minYear;
  const nextYear = Math.min(Math.max(baseYear + delta, minYear), MAX_YEAR);
  target.value = String(nextYear);
}

function handleYearInput(event: Event, kind: YearInputKind) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const normalizedValue = normalizeYearInput(input.value);
  input.value = normalizedValue;
  updateYearValue(kind, normalizedValue);
}

function handleYearWheel(event: WheelEvent, kind: YearInputKind) {
  if (event.deltaY === 0) {
    return;
  }

  stepYear(kind, event.deltaY > 0 ? 1 : -1);
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
</script>

选择公历或农历日期，快速查看对应的年柱、月柱、日柱、时柱。

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
    <label>农历日期</label>
    <div class="ganzhi-tool__select-grid">
      <div class="ganzhi-tool__year-field">
        <div class="ganzhi-tool__year-stepper">
          <button
            type="button"
            aria-label="农历年份减一"
            @click="stepYear('lunar', -1)"
          >
            -
          </button>
          <input
            :value="lunarYear"
            maxlength="4"
            inputmode="numeric"
            aria-label="农历年份"
            :aria-invalid="Boolean(lunarYearError)"
            @input="handleYearInput($event, 'lunar')"
            @wheel.prevent="handleYearWheel($event, 'lunar')"
          >
          <button
            type="button"
            aria-label="农历年份加一"
            @click="stepYear('lunar', 1)"
          >
            +
          </button>
        </div>
      </div>
      <select
        v-model="lunarMonth"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in lunarMonthOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <select
        v-model="lunarDay"
        @wheel.prevent="handleSelectWheel"
      >
        <option
          v-for="option in lunarDayOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>
    <p
      v-if="leapMonthHint"
      class="ganzhi-tool__hint"
    >
      {{ leapMonthHint }}
    </p>
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
  <div class="ganzhi-tool__field">
    <label>结果</label>
  </div>
  <div
    v-if="result"
    class="ganzhi-tool__result"
  >
    <p class="ganzhi-tool__main">{{ result.yearPillar }}年 {{ result.monthPillar }}月 {{ result.dayPillar }}日 {{ result.timePillar }}时</p>
    <p>公历：{{ result.solarLabel }}</p>
    <p>农历：{{ result.lunarLabel }}</p>
    <p>生肖：{{ result.zodiac }}</p>
  </div>
  <p
    v-else
    class="ganzhi-tool__error"
  >
    {{ activeError }}
  </p>
</div>

## 名词解释

- 年柱：用天干地支表示的年份。
- 月柱：用天干地支表示的月份。
- 日柱：用天干地支表示的日期。
- 时柱：用天干地支表示的时辰。

## 说明

- 支持公历 / 农历两种选择方式。
- 公历范围：0001-01-01 至 9999-12-31。
- 农历范围：〇年冬月十八至 九九九九年腊月初二。
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
}

.ganzhi-tool input[aria-invalid="true"] {
  border-color: var(--vp-c-danger-1);
}

.ganzhi-tool__mode {
  display: flex;
  gap: 8px;
}

.ganzhi-tool__mode button {
  padding: 8px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  cursor: pointer;
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
}

.ganzhi-tool__hint {
  margin: 0;
  color: var(--vp-c-text-2);
}

.ganzhi-tool__result {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.ganzhi-tool__main {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
}

.ganzhi-tool__result p,
.ganzhi-tool__error {
  margin: 0;
}

.ganzhi-tool__error {
  color: var(--vp-c-danger-1);
}

@media (max-width: 640px) {
  .ganzhi-tool__select-grid,
  .ganzhi-tool__compact-grid {
    grid-template-columns: 1fr;
  }
}
</style>
