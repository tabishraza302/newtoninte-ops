import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb } from '../../src/db/client'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { signAccessToken } from '../../src/services/tokens'

describe('Items read hardening (Task 3.6)', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  it('outsider user gets 404 read on GET /items/:id and filtered GET /items?team=:foreignTeamId', async () => {
    const teamA = await seedTeam()
    const teamB = await seedTeam()
    const memberA = await seedUser()
    const outsider = await seedUser()

    await seedMembership(memberA.id, teamA.id, 'lead')
    await seedMembership(outsider.id, teamB.id, 'member')

    const itemA = await seedItem(teamA.id, { title: 'Internal item', createdBy: memberA.id })

    const outsiderToken = await signAccessToken(outsider.id)

    // GET /items/:id for foreign team item -> 404
    const resItem = await request(app)
      .get(`/items/${itemA.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
    expect(resItem.status).toBe(404)
    expect(resItem.body.error?.code).toBe('NOT_FOUND')

    // GET /items?team=:foreignTeamId -> 404
    const resTeamList = await request(app)
      .get(`/items?team=${teamA.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
    expect(resTeamList.status).toBe(404)
    expect(resTeamList.body.error?.code).toBe('NOT_FOUND')
  })

  it('keyset pagination stability while items inserted between pages', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'lead')
    const token = await signAccessToken(user.id)

    // Seed 4 items with distinct priorities / timestamps
    const item1 = await seedItem(team.id, { title: 'Item 1', priority: 'urgent', createdBy: user.id })
    const item2 = await seedItem(team.id, { title: 'Item 2', priority: 'high', createdBy: user.id })
    const item3 = await seedItem(team.id, { title: 'Item 3', priority: 'medium', createdBy: user.id })
    const item4 = await seedItem(team.id, { title: 'Item 4', priority: 'low', createdBy: user.id })

    // Fetch page 1 with limit 2
    const page1Res = await request(app)
      .get(`/items?team=${team.id}&limit=2`)
      .set('Authorization', `Bearer ${token}`)
    expect(page1Res.status).toBe(200)
    expect(page1Res.body.items).toHaveLength(2)
    const page1Ids = page1Res.body.items.map((i: { id: number }) => i.id)
    expect(page1Ids).toEqual([item1.id, item2.id])
    const cursor = page1Res.body.nextCursor
    expect(cursor).toBeTruthy()

    // Insert new item with higher priority (or urgent) while paging
    await seedItem(team.id, { title: 'Inserted Item', priority: 'urgent', createdBy: user.id })

    // Fetch page 2 using cursor
    const page2Res = await request(app)
      .get(`/items?team=${team.id}&limit=2&cursor=${cursor}`)
      .set('Authorization', `Bearer ${token}`)
    expect(page2Res.status).toBe(200)
    expect(page2Res.body.items).toHaveLength(2)
    const page2Ids = page2Res.body.items.map((i: { id: number }) => i.id)
    expect(page2Ids).toEqual([item3.id, item4.id])

    // No overlap with page 1, and no skipped items from original set
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id)
    }
  })

  it('limit=0 and limit=1000 fail 422 VALIDATION_ERROR', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'member')
    const token = await signAccessToken(user.id)

    const res0 = await request(app)
      .get(`/items?team=${team.id}&limit=0`)
      .set('Authorization', `Bearer ${token}`)
    expect(res0.status).toBe(422)
    expect(res0.body.error?.code).toBe('VALIDATION_ERROR')

    const res1000 = await request(app)
      .get(`/items?team=${team.id}&limit=1000`)
      .set('Authorization', `Bearer ${token}`)
    expect(res1000.status).toBe(422)
    expect(res1000.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('malformed cursor fails 422 VALIDATION_ERROR', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'member')
    const token = await signAccessToken(user.id)

    const res = await request(app)
      .get(`/items?team=${team.id}&cursor=not-a-valid-cursor-json`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(422)
    expect(res.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('cursor from team A replayed with team B fails 422 (foreign-scope cursor rejected)', async () => {
    const teamA = await seedTeam()
    const teamB = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, teamA.id, 'member')
    await seedMembership(user.id, teamB.id, 'member')
    const token = await signAccessToken(user.id)

    // Seed items in Team A
    await seedItem(teamA.id, { title: 'Item A1', priority: 'high', createdBy: user.id })
    await seedItem(teamA.id, { title: 'Item A2', priority: 'medium', createdBy: user.id })
    await seedItem(teamA.id, { title: 'Item A3', priority: 'low', createdBy: user.id })

    // Seed items in Team B
    await seedItem(teamB.id, { title: 'Item B1', priority: 'high', createdBy: user.id })
    await seedItem(teamB.id, { title: 'Item B2', priority: 'medium', createdBy: user.id })

    // Fetch page 1 for Team A
    const resA = await request(app)
      .get(`/items?team=${teamA.id}&limit=1`)
      .set('Authorization', `Bearer ${token}`)
    expect(resA.status).toBe(200)
    const cursorA = resA.body.nextCursor
    expect(cursorA).toBeTruthy()

    // Replay cursorA on Team B -> 422 VALIDATION_ERROR
    const resB = await request(app)
      .get(`/items?team=${teamB.id}&cursor=${cursorA}`)
      .set('Authorization', `Bearer ${token}`)
    expect(resB.status).toBe(422)
    expect(resB.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('q=% returns only literal-percent row', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'member')
    const token = await signAccessToken(user.id)

    const percentItem = await seedItem(team.id, { title: '100% done', createdBy: user.id })
    await seedItem(team.id, { title: 'plain task', createdBy: user.id })
    await seedItem(team.id, { title: 'another item without percent', createdBy: user.id })

    const res = await request(app)
      .get(`/items?team=${team.id}&q=%`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]?.id).toBe(percentItem.id)
    expect(res.body.items[0]?.title).toBe('100% done')
  })
})
