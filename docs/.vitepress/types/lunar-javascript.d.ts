declare module "lunar-javascript" {
  interface LunarInstance {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    toString(): string;
    getYearInGanZhi(): string;
    getYearInGanZhiByLiChun(): string;
    getMonthInGanZhi(): string;
    getDayInGanZhiExact(): string;
    getDayInGanZhiExact2(): string;
    getTimeInGanZhi(): string;
    getYearShengXiao(): string;
    getYearShengXiaoByLiChun(): string;
    getSolar(): SolarInstance;
  }

  interface SolarInstance {
    getDay(): number;
    toYmd(): string;
    getMonth(): number;
    getYear(): number;
    getLunar(): LunarInstance;
  }

  interface LunisolarCalendarInstance {
    getDay(): number;
    getMonth(): number;
    getYear(): number;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarInstance;
    fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): SolarInstance;
  };

  export const Lunar: {
    fromYmd(year: number, month: number, day: number): LunarInstance;
    fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): LunarInstance;
  };

  export const LunarMonth: {
    fromYm(
      year: number,
      month: number,
    ): {
      getDayCount(): number;
    };
  };

  export const LunarYear: {
    fromYear(year: number): {
      getLeapMonth(): number;
    };
  };

  export const Foto: {
    fromLunar(lunar: LunarInstance): LunisolarCalendarInstance;
  };

  export const Tao: {
    fromLunar(lunar: LunarInstance): LunisolarCalendarInstance;
  };
}
