-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "passwordSalt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "passwordUpdatedAt" TIMESTAMP(3);
