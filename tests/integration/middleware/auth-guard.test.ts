import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { users } from '../../../src/db/schema/users.js';

describe('Auth Guard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('returns 401 when the access token is expired', async () => {
    const { user } = await createTestUser(app);

    const db = getTestDb();
    const [row] = await db.select({ jwtPrivateKey: users.jwtPrivateKey })
      .from(users)
      .where(eq(users.id, user.id));

    const expiredToken = jwt.sign(
      { sub: user.id, nonce: 0, type: 'access' },
      row.jwtPrivateKey,
      { algorithm: 'ES256', expiresIn: '-1s' },
    );

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { user: { first_name: 'Updated' } },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.message).toBe('Token expired');
  });
});
