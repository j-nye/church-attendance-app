-- CreateTable
CREATE TABLE "ServiceSpeaker" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceSpeaker_eventId_idx" ON "ServiceSpeaker"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSpeaker_eventId_name_key" ON "ServiceSpeaker"("eventId", "name");

-- AddForeignKey
ALTER TABLE "ServiceSpeaker" ADD CONSTRAINT "ServiceSpeaker_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
