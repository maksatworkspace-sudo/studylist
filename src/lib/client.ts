export type Result = {
  ok?: boolean;
  id?: string;
  number?: number;
  code?: string;
  message?: string;
  localToken?: string;
  tokenPurpose?: string;
  url?: string;
  local?: boolean;
};
export async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Байланыс үзілді. Қайта көріңіз.");
  return data;
}
export async function send(
  action: string,
  input: Record<string, unknown> = {},
): Promise<Result> {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...input }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Сұраныс орындалмады.");
  return data;
}
export const date = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    timeZone: "Asia/Almaty",
  }).formatToParts(new Date(value));
  const day = parts.find((p) => p.type === "day")!.value;
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return `${day} ${["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."][month - 1]}`;
};
export const size = (value: number) =>
  value < 1024
    ? `${value} Б`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} КБ`
      : `${(value / 1048576).toFixed(1)} МБ`;
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
export const teacherColor = (color: string) =>
  ({
    blue: "#e6eeff",
    mint: "#e1f4ed",
    rose: "#f8e7ed",
    amber: "#fcf0d5",
    violet: "#eee9f7",
  })[color] || "#e6eeff";
