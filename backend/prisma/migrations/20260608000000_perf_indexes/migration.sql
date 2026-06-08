-- Performance indexes for high-concurrency exam workloads (100-500 students).
-- All use IF NOT EXISTS so the migration is safe to re-run and won't clash
-- with indexes Prisma may already have created.

-- exam_sessions: hot paths are dashboard listing, resume lookup, multi-device
-- detection, and IP-anomaly grouping.
CREATE INDEX IF NOT EXISTS "exam_sessions_studentId_status_idx"
  ON "exam_sessions" ("studentId", "status");
CREATE INDEX IF NOT EXISTS "exam_sessions_studentId_examId_idx"
  ON "exam_sessions" ("studentId", "examId");
CREATE INDEX IF NOT EXISTS "exam_sessions_examId_ipAddress_idx"
  ON "exam_sessions" ("examId", "ipAddress");

-- behavioral_flags: anomaly dashboards filter heavily by flagType.
CREATE INDEX IF NOT EXISTS "behavioral_flags_flagType_idx"
  ON "behavioral_flags" ("flagType");
CREATE INDEX IF NOT EXISTS "behavioral_flags_flagType_sessionId_idx"
  ON "behavioral_flags" ("flagType", "sessionId");
