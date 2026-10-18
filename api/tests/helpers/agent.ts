import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../../src/app'

/** A supertest agent bound to `app`; it keeps cookies across requests. */
export function agent(app: Express): request.Agent {
  return request(app)
}

/**
 * Logs in through `POST /auth/login` and returns the access token alongside the
 * authenticated agent. The route lands in Task 2.16, so this is not exercised
 * until Slice 2 — see Task 2.19 for its covering test.
 */
export async function loginAs(
  email: string,
  password: string,
): Promise<{ token: string; agent: request.Agent }> {
  const client = agent(createApp())
  const res = await client.post('/auth/login').send({ email, password })
  if (res.status !== 200) {
    throw new Error(`loginAs: POST /auth/login failed with ${res.status}: ${JSON.stringify(res.body)}`)
  }
  const token: unknown = res.body?.accessToken
  if (typeof token !== 'string') {
    throw new Error('loginAs: POST /auth/login response is missing an accessToken')
  }
  return { token, agent: client }
}
