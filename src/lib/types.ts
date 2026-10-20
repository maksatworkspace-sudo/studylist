export type Role = "user" | "teacher" | "admin" | "leadership";
export type FeedbackType = "opinion" | "suggestion" | "issue";
export type Status =
  "new" | "reviewing" | "resolved" | "in_progress" | "reviewed";
export type Viewer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  verified: boolean;
  active?: boolean;
};
export type Course = { id: string; name: string };
export type Teacher = {
  id: string;
  name: string;
  subject: string;
  color: string;
  average: number;
  count: number;
  myStars: number;
  myComment: string;
  reviews: { name: string; stars: number; comment: string; date: string }[];
};
export type Post = {
  id: string;
  number: number;
  type: FeedbackType;
  title: string;
  body: string;
  course: string | null;
  teacher: string | null;
  customTarget: string | null;
  courseId: string | null;
  teacherId: string | null;
  anonymous: boolean;
  authorName: string;
  status: Status | null;
  outcome: string | null;
  confirmed: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  updatedAt: string;
  supports: number;
  comments: number;
  supported: boolean;
  saved: boolean;
  isAccountOwner: boolean;
  isOwner: boolean;
  canEdit: boolean;
  answered: boolean;
  flagged: boolean;
};
export type Comment = {
  id: string;
  name: string;
  role: Role;
  body: string;
  parentId: string | null;
  mine: boolean;
  deleted: boolean;
  createdAt: string;
};
export type Attachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
};
export type Detail = {
  post: Post;
  contact: { email: string; phone: string } | null;
  moderationReasons: string[];
  replies: { id: string; name: string; body: string; createdAt: string }[];
  comments: Comment[];
  attachments: Attachment[];
  history: { status: Status; outcome: string | null; createdAt: string }[];
};
export type Notice = {
  id: string;
  feedbackId: string | null;
  title: string;
  read: boolean;
  createdAt: string;
};
export type Statistics = {
  total: number;
  resolved: number;
  reviewing: number;
  resolutionHours: number;
  monthly: { month: string; count: number }[];
  types: { type: string; count: number }[];
  courses: { name: string; count: number }[];
  instructors: { name: string; count: number }[];
  statuses: { status: Status; count: number }[];
  comparison: { current: number; previous: number };
};
export type Boot = {
  viewer: Viewer | null;
  demo: boolean;
  posts: Post[];
  courses: Course[];
  teachers: Teacher[];
  notifications: Notice[];
  staff: Viewer[];
  catalog: {
    courses: { id: string; name: string; active: boolean }[];
    teachers: { id: string; name: string; subject: string; active: boolean }[];
  } | null;
  stats: Statistics | null;
  integrations: { email: boolean; ai: boolean; storage: boolean } | null;
};
export const typeLabels: Record<FeedbackType, string> = {
  opinion: "Пікір",
  suggestion: "Ұсыныс",
  issue: "Мәселе",
};
export const statusLabels: Record<Status, string> = {
  new: "Жаңа",
  reviewing: "Қаралуда",
  resolved: "Шешілді",
  in_progress: "Қаралып жатыр",
  reviewed: "Қаралды",
};
export const roleLabels: Record<Role, string> = {
  user: "Қолданушы",
  teacher: "Оқытушы",
  admin: "Әкімші",
  leadership: "Басшылық",
};
export const isManager = (role?: Role) =>
  role === "admin" || role === "leadership";
