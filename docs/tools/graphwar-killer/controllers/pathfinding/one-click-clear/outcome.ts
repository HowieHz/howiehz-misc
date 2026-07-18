/** 有效一键清图尝试可触发自动导出的失败类别。 */
export type GraphwarOneClickClearFailureKind = "incomplete" | "search-error" | "search-failure";

/** 自动导出还包括托管时间预算主动截断搜索的结局。 */
export type GraphwarClearFailureExportKind = GraphwarOneClickClearFailureKind | "deadline";
