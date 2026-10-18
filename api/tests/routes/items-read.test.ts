import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb } from '../../src/db/client'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { signAccessToken } from '../../src/services/tokens'

describe('Items read routes (Task 3.5)', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  it('GET /items requires authentication (401)', async () => {
    const res = await request(app).get('/items')
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe('UNAUTHENTICATED')
  })

  it('GET /items returns paginated and scoped items for authenticated actor', async () => {
    const teamA = await seedTeam({ name: 'Alpha Team', slug: 'alpha' })
    const teamB = await seedTeam({ name: 'Beta Team', slug: 'beta' })
    const user = await seedUser({ email: 'user@example.test' })
    await seedMembership(user.id, teamA.id, 'member')

    const itemA1 = await seedItem(teamA.id, { title: 'Alpha Item 1', priority: 'high', createdBy: user.id })
    const itemA2 = await seedItem(teamA.id, { title: 'Alpha Item 2', priority: 'medium', createdBy: user.id })
    const itemB1 = await seedItem(teamB.id, { title: 'Beta Item 1', priority: 'urgent', createdBy: user.id })

    const token = await signAccessToken(user.id)

    const res = await request(app)
      .get('/items')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('items')
    expect(res.body).toHaveProperty('nextCursor')
    const ids = res.body.items.map((i: { id: number }) => i.id)
    expect(ids).toContain(itemA1.id)
    expect(ids).toContain(itemA2.id)
    expect(ids).not.toContain(itemB1.id)
  })

  it('GET /items/:id returns item with version and creator/assignee info', async () => {
    const team = await seedTeam()
    const user = await seedUser({ email: 'owner@example.test', displayName: 'Owner' })
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, {
      title: 'Detailed Item',
      description: 'Some description',
      priority: 'high',
      status: 'open',
      createdBy: user.id,
      assigneeId: user.id,
    })

    const token = await signAccessToken(user.id)

    const res = await request(app)
      .get(`/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.item).toBeDefined()
    expect(res.body.item.id).toBe(item.id)
    expect(res.body.item.title).toBe('Detailed Item')
    expect(res.body.item.version).toBe(1)
    expect(res.body.item.creator).toBeDefined()
    expect(res.body.item.creator.id).toBe(user.id)
    expect(res.body.item.assignee).toBeDefined()
    expect(res.body.item.assignee.id).toBe(user.id)
  })

  it('GET /items/:id for foreign item returns 404 envelope', async () => {
    const teamA = await seedTeam()
    const teamB = await seedTeam()
    const userA = await seedUser()
    const userB = await seedUser()
    await seedMembership(userA.id, teamA.id, 'member')
    await seedMembership(userB.id, teamB.id, 'member')

    const itemB = await seedItem(teamB.id, { title: 'Secret Item', createdBy: userB.id })

    const tokenA = await signAccessToken(userA.id)

    const res = await request(app)
      .get(`/items/${itemB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('GET /items/:id with invalid id returns 422 VALIDATION_ERROR envelope', async () => {
    const user = await seedUser()
    const token = await signAccessToken(user.id)

    const res = await request(app)
      .get('/items/abc')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('GET /items with invalid limit (<1 or >100) returns 422 VALIDATION_ERROR envelope', async () => {
    const user = await seedUser()
    const token = await signAccessToken(user.id)

    const resZero = await request(app)
      .get('/items?limit=0')
      .set('Authorization', `Bearer ${token}`)
    expect(resZero.status).toBe(422)
    expect(resZero.body.error?.code).toBe('VALIDATION_ERROR')

    const resHuge = await request(app)
      .get('/items?limit=101')
      .set('Authorization', `Bearer ${token}`)
    expect(resHuge.status).toBe(422)
    expect(resHuge.body.error?.code).toBe('VALIDATION_ERROR')
  })
})
