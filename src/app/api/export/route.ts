import ExcelJS from "exceljs";
import { context, requireManager } from "@/server/context";
import { statistics, teachers } from "@/server/queries";
import { failure } from "@/server/http";
import { z } from "zod";
import { statusLabels, typeLabels } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const ctx = await context(request);
    requireManager(ctx);
    const url = new URL(request.url);
    const date = z.iso.date().optional();
    const stats = await statistics(
      ctx,
      date.parse(url.searchParams.get("from") || undefined),
      date.parse(url.searchParams.get("to") || undefined),
    );
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Жалпы есеп");
    sheet.columns = [
      { header: "Көрсеткіш", key: "name", width: 45 },
      { header: "Мәні", key: "value", width: 20 },
    ];
    sheet.addRows([
      { name: "Кері байланыс саны", value: stats.total },
      { name: "Шешілген мәселелер", value: stats.resolved },
      { name: "Қаралуда", value: stats.reviewing },
      {
        name: "Шешілу уақыты (сағат)",
        value: Math.round(stats.resolutionHours * 10) / 10,
      },
    ]);
    const types = book.addWorksheet("Түрлері");
    types.columns = [
      { header: "Түрі", key: "type", width: 30 },
      { header: "Саны", key: "count", width: 15 },
    ];
    types.addRows(
      stats.types.map((t) => ({
        ...t,
        type: typeLabels[t.type as keyof typeof typeLabels],
      })),
    );
    const monthly = book.addWorksheet("Айлық өзгеріс");
    monthly.columns = [
      { header: "Ай", key: "month", width: 20 },
      { header: "Саны", key: "count", width: 15 },
    ];
    monthly.addRows(stats.monthly);
    const courses = book.addWorksheet("Курстар");
    courses.columns = [
      { header: "Курс", key: "name", width: 45 },
      { header: "Саны", key: "count", width: 15 },
    ];
    courses.addRows(stats.courses);
    const statuses = book.addWorksheet("Мәртебелер");
    statuses.columns = [
      { header: "Мәртебе", key: "name", width: 35 },
      { header: "Саны", key: "count", width: 15 },
    ];
    statuses.addRows(
      stats.statuses.map((s) => ({
        name: statusLabels[s.status],
        count: s.count,
      })),
    );
    const instructors = book.addWorksheet("Оқытушы жазбалары");
    instructors.columns = [
      { header: "Оқытушы", key: "name", width: 35 },
      { header: "Саны", key: "count", width: 15 },
    ];
    instructors.addRows(stats.instructors);
    monthly.addRow({ month: "Соңғы ай", count: stats.comparison.current });
    monthly.addRow({ month: "Алдыңғы ай", count: stats.comparison.previous });
    const ratings = book.addWorksheet("Оқытушылар");
    ratings.columns = [
      { header: "Оқытушы", key: "name", width: 30 },
      { header: "Курс", key: "subject", width: 40 },
      { header: "Орташа баға", key: "average", width: 18 },
      { header: "Баға саны", key: "count", width: 15 },
    ];
    ratings.addRows(
      (await teachers(ctx)).map((t) => ({
        name: t.name,
        subject: t.subject,
        average: t.average,
        count: t.count,
      })),
    );
    for (const tab of book.worksheets) {
      tab.getRow(1).font = { bold: true };
      tab.views = [{ state: "frozen", ySplit: 1 }];
    }
    const buffer = await book.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=maxball-report.xlsx",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
