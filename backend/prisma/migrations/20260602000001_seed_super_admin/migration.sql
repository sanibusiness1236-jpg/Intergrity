-- Promote blayerzoameke@gmail.com to Super Admin
-- This runs via prisma migrate deploy on every fresh deployment.
UPDATE "users"
SET "isSuperAdmin" = true,
    "role"         = 'ADMIN',
    "isActive"     = true
WHERE "email" = 'blayerzoameke@gmail.com';
