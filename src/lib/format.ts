const zhNumberFormat = new Intl.NumberFormat("zh-CN");

export function formatNumber(value: number): string {
  return zhNumberFormat.format(value || 0);
}

export function timeAgo(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;

  const difference = Math.max(0, now - timestamp);
  if (difference < 60_000) return "刚刚";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}
