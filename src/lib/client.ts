import { appService } from "@/services";
import { actionNames, ServiceError } from "@/services/types";
import type { ActionInputs, ActionName, DateRange, Download, Progress, Result } from "@/services/types";
export type { Result } from "@/services/types";

export async function read<T>(url: string): Promise<T> {
  const parsed = new URL(url, "http://service.local");
  if (parsed.pathname !== "/api/state") throw new ServiceError("Қолдау көрсетілмейтін сұраныс.");
  const post = parsed.searchParams.get("post");
  return (post ? await appService().detail(post) : await appService().boot({
    from: parsed.searchParams.get("from") || undefined,
    to: parsed.searchParams.get("to") || undefined,
  })) as T;
}
export async function send(
  action: string,
  input: Record<string, unknown> = {},
): Promise<Result> {
  if (!actionNames.includes(action as ActionName))
    throw new ServiceError(`Қолдау көрсетілмейтін әрекет: ${action}`);
  return appService().send(action as ActionName, input as ActionInputs[ActionName]);
}
export const uploadFile = (file: File, progress?: Progress) => appService().upload(file, progress);
export const temporaryPreview = () => appService().mode === "mock";
function saveDownload(file: Download) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url; link.download = file.name; document.body.appendChild(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadFile(id: string) { saveDownload(await appService().download(id)); }
export async function exportReport(range: DateRange) { saveDownload(await appService().exportReport(range)); }
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
