export type Role = "ADMIN" | "EXAMINER" | "STUDENT" | "INVIGILATOR";

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  studentId?: string;
  program?: string;
  gender?: string;
  avatarUrl?: string;
  institutionId?: string;
  isSuperAdmin?: boolean;
}

export interface InviteLink {
  id: string;
  token: string;
  role: Role;
  expiresAt: string;
  singleUse: boolean;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  note?: string;
  createdAt: string;
}

export interface Institution {
  id: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export type ExamStatus = "DRAFT" | "PUBLISHED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type QuestionType = "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MULTI_BLANK_EQUATION" | "TEMPLATE_FILL";
export type ExamType = "QUIZ" | "MIDSEMESTER" | "ASSIGNMENT" | "END_OF_SEMESTER" | "OTHER";

export interface GradeRange {
  grade: string;
  min: number;
  max: number;
}

export interface ScoreRemark {
  min: number;
  max: number;
  remark: string;
}

export interface Exam {
  id: string;
  title: string;
  description?: string;
  instructions?: string;
  courseCode: string;
  courseName: string;
  examType: ExamType;
  examTypeOther?: string;
  examPassword?: string;
  status: ExamStatus;
  durationMinutes: number;
  startTime?: string;
  endTime?: string;
  totalMarks: number;
  shuffleQuestions: boolean;
  allowBacktrack: boolean;
  isActive: boolean;
  maxAttempts: number;
  showScoreToStudents: boolean;
  showRemarksToStudents: boolean;
  gradingSystem?: GradeRange[];
  scoreRemarks?: ScoreRemark[];
  createdById: string;
  institutionId: string;
  questions?: Question[];
  venues?: Venue[];
  _count?: { questions: number; examSessions: number; submittedSessions: number };
}

export interface QuestionBlock {
  id: string;
  type: "latex" | "image" | "code" | "table" | "audio";
  content?: string;
  url?: string;
  data?: string[][];
  language?: string;
}

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  text: string;
  options?: Record<string, string> | string[];
  correctAnswer: unknown;
  marks: number;
  order: number;
  explanation?: string;
  fillInBlankType?: "text" | "dropdown";
  blocks?: QuestionBlock[];
}

export type SessionStatus = "WAITING" | "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT" | "DISCONNECTED";

export interface ExamSession {
  id: string;
  examId: string;
  studentId: string;
  status: SessionStatus;
  startedAt?: string;
  submittedAt?: string;
  score?: number;
  maxScore?: number;
}

export type FlagType =
  | "TAB_SWITCH"
  | "PASTE_EVENT"
  | "WINDOW_BLUR"
  | "USB_DETECTED"
  | "MULTI_DEVICE"
  | "IP_ANOMALY"
  | "ANSWER_SIMILARITY"
  | "TIMING_ANOMALY";

export interface BehavioralFlag {
  id: string;
  sessionId: string;
  studentId: string;
  flagType: FlagType;
  metadata?: unknown;
  createdAt: string;
}

export interface IntegrityPrediction {
  student_id: string;
  clean_prob: number;
  flagged_prob: number;
  prediction: "clean" | "flagged";
}

export interface ModelMetrics {
  model: string;
  train_acc: number;
  precision_macro: number;
  recall_macro: number;
  f1_macro: number;
  confusion_matrix: number[][];
  heatmap_path?: string;
}

export interface BenchmarkResult {
  dataset_info: {
    num_nodes: number;
    num_edges: number;
    num_cheaters: number;
    num_clean: number;
  };
  results: ModelMetrics[];
}

export interface Venue {
  id: string;
  name: string;
  examId: string;
  capacity: number;
  invigilatorId?: string;
}

export interface InvigilatorReport {
  id: string;
  venueId: string;
  authorId: string;
  content: string;
  severity: string;
  createdAt: string;
}
