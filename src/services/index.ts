import { createHttpService } from "./http";
import { createMockService } from "./mock";
import type { AppService } from "./types";
import { ServiceError } from "./types";

export function createService(mode = "http", environment = process.env.NODE_ENV): AppService {
  if (mode === "mock") {
    if (environment !== "development" && environment !== "test")
      throw new ServiceError("Mock preview is development/test-only.", 503);
    return createMockService();
  }
  if (mode !== "http") throw new ServiceError(`Unknown service mode: ${mode}`, 503);
  return createHttpService();
}
let current: AppService | undefined;
export function appService(): AppService {
  return current ??= createService(process.env.NEXT_PUBLIC_SERVICE_MODE || "http");
}
