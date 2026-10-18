import { describe, it, expect } from 'vitest'
import * as s from '../../src/db/schema'
import { ACTIVITY_TYPES, type ActivityType } from '../../src/domain/types'
describe('schema: work', () => {
  it('exposes the work tables', () => {
    for (const t of ['workItems','activityEvents','comments','notifications','outboxJobs','idempotencyKeys'])
      expect(s).toHaveProperty(t)
  })
  it('ACTIVITY_TYPES has the 9 activity members', () => {
    expect(ACTIVITY_TYPES).toEqual([
      'created','status_changed','assignee_changed','priority_changed','type_changed',
      'comment_added','due_changed','title_changed','description_changed',
    ])
    // Type-level: every member is assignable to ActivityType.
    const covers: ActivityType[] = [...ACTIVITY_TYPES]
    expect(covers).toHaveLength(9)
  })
})
