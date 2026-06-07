-- AlterEnum: add PAGE_REFRESH value to FlagType
-- This is non-destructive and idempotent
ALTER TYPE "FlagType" ADD VALUE IF NOT EXISTS 'PAGE_REFRESH';
