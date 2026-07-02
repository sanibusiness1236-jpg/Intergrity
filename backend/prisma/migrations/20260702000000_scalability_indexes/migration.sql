-- Scalability indexes for high-concurrency workloads (1 000–10 000 students).
-- Every index uses IF NOT EXISTS so this migration is idempotent and safe
-- to re-run without dropping already-existing indexes.

-- ── exam_sessions ────────────────────────────────────────────────────────────
-- Hot path: startSession checks for IN_PROGRESS/WAITING/DISCONNECTED sessions
-- for a given student + exam. The existing (studentId, examId) index covers
-- the WHERE clause; a partial index on status speeds up the status filter.
CREATE INDEX IF NOT EXISTS "exam_sessions_active_status_idx"
  ON "exam_sessions" ("examId", "studentId")
  WHERE "status" IN ('IN_PROGRESS', 'WAITING', 'DISCONNECTED');

-- Hot path: getActiveSessions polls all IN_PROGRESS sessions, often filtered
-- by examId. A partial index on the active status dramatically reduces rows
-- examined when only a fraction of sessions are live.
CREATE INDEX IF NOT EXISTS "exam_sessions_in_progress_idx"
  ON "exam_sessions" ("examId", "startedAt")
  WHERE "status" = 'IN_PROGRESS';

-- ── behavioral_flags ─────────────────────────────────────────────────────────
-- getFlagSummary aggregates by (examId ← session.examId). The route joins
-- flags through sessions so a direct examId index on behavioral_flags helps
-- the groupBy + WHERE session.examId path.
CREATE INDEX IF NOT EXISTS "behavioral_flags_student_created_idx"
  ON "behavioral_flags" ("studentId", "createdAt" DESC);

-- ── answers ──────────────────────────────────────────────────────────────────
-- submitExam deletes all answers for a session before createMany.
-- The existing unique index on (sessionId, questionId) is used for the DELETE
-- but adding a separate sessionId-only index speeds up the deleteMany scan.
CREATE INDEX IF NOT EXISTS "answers_sessionId_idx"
  ON "answers" ("sessionId");

-- ── questions ────────────────────────────────────────────────────────────────
-- exam.controller getExam fetches questions ORDER BY order.
-- The existing (examId, order) index covers this; confirm it exists.
CREATE INDEX IF NOT EXISTS "questions_examId_order_idx"
  ON "questions" ("examId", "order");

-- ── invite_links ─────────────────────────────────────────────────────────────
-- Validate endpoint does WHERE token = ? — unique index already covers this.
-- Add an expiry + isActive index so expired/inactive tokens are filtered early.
CREATE INDEX IF NOT EXISTS "invite_links_active_expires_idx"
  ON "invite_links" ("isActive", "expiresAt")
  WHERE "isActive" = true;

-- ── users ────────────────────────────────────────────────────────────────────
-- Login looks up by email; the unique constraint is the index.
-- Additionally, dashboard queries filter by (institutionId, role).
CREATE INDEX IF NOT EXISTS "users_institution_role_idx"
  ON "users" ("institutionId", "role")
  WHERE "isActive" = true;
