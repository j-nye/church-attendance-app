-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoryType" ADD VALUE 'GROWTH_TRACK';
ALTER TYPE "CategoryType" ADD VALUE 'SERVICE_METRIC';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "countsTowardTotal" BOOLEAN NOT NULL DEFAULT true;
