import type { CategoryType } from '@prisma/client'

export const TYPE_LABELS: Record<CategoryType, string> = {
  SECTION: 'Sanctuary',
  CLASSROOM: 'Classrooms',
  GROWTH_TRACK: 'Growth Track',
  SERVE_TEAM: 'Serve Teams',
  SERVICE_METRIC: 'Ministry Metrics',
}
