import { describe, it, expect } from 'vitest'
import * as s from '../../src/db/schema'
describe('schema: work', () => {
  it('exposes the work tables', () => {
    for (const t of ['workItems','activityEvents','comments','outboxJobs','idempotencyKeys'])
      expect(s).toHaveProperty(t)
  })
})
