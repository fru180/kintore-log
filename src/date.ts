export const toLocalDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const displayDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(
    new Date(year, month - 1, day),
  );
};

export const monthLabel = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return `${year}年 ${month}月`;
};

export const shiftMonth = (value: string, amount: number) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const shiftDay = (value: string, amount: number) => {
  const [year, month, day] = value.split("-").map(Number);
  return toLocalDate(new Date(year, month - 1, day + amount));
};

export const daysBetween = (from: string, to: string) => {
  const toUtcTime = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return (toUtcTime(to) - toUtcTime(from)) / (24 * 60 * 60 * 1000);
};

export const datePosition = (value: string, start: string, end: string) => {
  const range = daysBetween(start, end);
  return range === 0 ? 0 : daysBetween(start, value) / range;
};
