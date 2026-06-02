-- AlterTable: add isSuperAdmin column to users
ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: invite_links
CREATE TABLE "invite_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "singleUse" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_links_token_key" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "invite_links_token_idx" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "invite_links_createdById_idx" ON "invite_links"("createdById");

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
