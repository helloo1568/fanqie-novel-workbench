/** 数字格式化：1000 → 1,000 */
export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 日期 */
export function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}
