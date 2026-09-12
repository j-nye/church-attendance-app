-- AlterTable
ALTER TABLE "Event" ADD COLUMN "startTime" TEXT NOT NULL DEFAULT '09:30';

-- CreateIndex
CREATE INDEX "Event_serviceDate_startTime_idx" ON "Event"("serviceDate", "startTime");
