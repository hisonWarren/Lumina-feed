// 检索广度：各开放源各取最相关 N 条，合并去重（非全库遍历）
export const SOURCE_LIMIT = { standard: 25, full: 50 };

export function sourceLimitFor(depth) {
  return depth === "full" ? SOURCE_LIMIT.full : SOURCE_LIMIT.standard;
}

export const SEARCH_DEPTH_META = {
  standard: {
    label: "快",
    hint: "每个数据库最多取 25 条最相关结果，合并去重后展示",
  },
  full: {
    label: "广",
    hint: "每个数据库最多取 50 条，覆盖更广但更慢",
  },
};
