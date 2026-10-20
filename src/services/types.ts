import type { Boot, Detail, FeedbackType, Role, Status } from "@/lib/types";

export type Result = {
  ok?: boolean;
  id?: string;
  number?: number;
  code?: string | null;
  message?: string;
  localToken?: string;
  tokenPurpose?: string;
  url?: string;
  local?: boolean;
  duplicate?: boolean;
};
export type DateRange = { from?: string; to?: string };
export type Download = { blob: Blob; name: string };
export type Progress = (percent: number) => void;
export type ActionInputs = {
  demoLogin: { role: Role };
  logout: Record<string, never>;
  login: { email: string; password: string };
  register: { email: string; password: string; name: string; phone: string };
  resendConfirmation: { email: string };
  confirmEmail: { token: string };
  exchangeSession: { accessToken: string; refreshToken: string };
  forgotPassword: { email: string };
  resetPassword: { password: string; token?: string };
  updateProfile: { name: string; phone: string };
  createStaff: { name: string; email: string; phone: string; role: Role; subject?: string };
  createPost: {
    requestId: string; type: FeedbackType; title: string; body: string;
    anonymous: boolean; authorName?: string; email?: string;
    courseId?: string | null; teacherId?: string | null; customTarget?: string;
    attachments?: string[];
  };
  unlockPost: { number: string | number; code: string };
  recoverPost: { email: string };
  resetGuestCode: { token: string };
  toggleSupport: { id: string };
  toggleBookmark: { id: string };
  editPost: { id: string; title: string; body: string };
  deletePost: { id: string };
  comment: { id: string; body: string; parentId?: string | null };
  editComment: { id: string; body: string };
  deleteComment: { id: string };
  rateTeacher: { id: string; stars: number; comment?: string };
  officialReply: { id: string; body: string };
  setStatus: { id: string; status: Status; outcome?: "implemented" | "declined" | null };
  resolution: { id: string; resolved: boolean };
  moderate: { id: string; mode: "hide" | "restore" | "delete"; reason?: string };
  moderateComment: { id: string; mode: "hide" | "restore" | "delete"; reason?: string };
  report: {
    targetType: "post" | "comment";
    targetId: string;
    reason: "spam" | "harassment" | "inappropriate" | "other";
    note?: string;
  };
  setReportStatus: {
    targetType: "post" | "comment";
    targetId: string;
    status: "reviewing" | "resolved" | "dismissed";
  };
  readNotifications: { id?: string };
  addCourse: { name: string };
  addTeacher: { name: string; subject?: string };
  setRole: { id: string; role: Role };
  updateCatalog: { id: string; kind: "course" | "teacher"; name: string; subject?: string; active: boolean };
  setAccountActive: { id: string; active: boolean };
  prepareUpload: { name: string; size: number; mime?: string };
  completeUpload: { id: string };
  discardUpload: { id: string };
  runJobs: Record<string, never>;
};
export type ActionName = keyof ActionInputs;
export const actionNames: readonly ActionName[] = [
  "demoLogin", "logout", "login", "register", "resendConfirmation", "confirmEmail",
  "exchangeSession", "forgotPassword", "resetPassword", "updateProfile", "createStaff",
  "createPost", "unlockPost", "recoverPost", "resetGuestCode", "toggleSupport",
  "toggleBookmark", "editPost", "deletePost", "comment", "editComment", "deleteComment",
  "rateTeacher", "officialReply", "setStatus", "resolution", "moderate",
  "moderateComment", "report", "setReportStatus",
  "readNotifications", "addCourse", "addTeacher", "setRole", "updateCatalog",
  "setAccountActive", "prepareUpload", "completeUpload", "discardUpload", "runJobs",
];
export interface AppService {
  readonly mode: "http" | "mock";
  boot(range?: DateRange): Promise<Boot>;
  detail(id: string): Promise<Detail>;
  send<A extends ActionName>(action: A, input: ActionInputs[A]): Promise<Result>;
  upload(file: File, progress?: Progress): Promise<Result>;
  download(id: string): Promise<Download>;
  exportReport(range?: DateRange): Promise<Download>;
}
export class ServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ServiceError";
  }
}
