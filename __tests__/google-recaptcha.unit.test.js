/**
 * Unit tests for the reCAPTCHA middleware and Google ID-token verification.
 * These run without a database — Google's HTTP endpoints are mocked via
 * global.fetch.
 */

const { verifyRecaptcha } = require('../src/middleware/recaptcha');
const { verifyGoogleIdToken } = require('../src/config/googleAuth');

const realFetch = global.fetch;

function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RECAPTCHA_SECRET_KEY;
  delete process.env.GOOGLE_CLIENT_ID;
});

describe('verifyRecaptcha middleware', () => {
  test('is a no-op when RECAPTCHA_SECRET_KEY is not set', async () => {
    const next = jest.fn();
    const res = mockRes();
    await verifyRecaptcha({ body: {} }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  test('rejects with 422 when secret is set but no token supplied', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret';
    const next = jest.fn();
    const res = mockRes();
    await verifyRecaptcha({ body: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/captcha/i);
  });

  test('rejects with 422 when Google says the token is invalid', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: false }) });
    const next = jest.fn();
    const res = mockRes();
    await verifyRecaptcha({ body: { recaptcha: 'bad-token' }, ip: '1.2.3.4' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });

  test('calls next when Google confirms the token', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    const next = jest.fn();
    const res = mockRes();
    await verifyRecaptcha({ body: { recaptcha: 'good-token' }, ip: '1.2.3.4' }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    // secret + token actually sent to siteverify
    const sentBody = global.fetch.mock.calls[0][1].body;
    expect(sentBody).toContain('secret=secret');
    expect(sentBody).toContain('response=good-token');
  });

  test('fails closed with 502 when siteverify is unreachable', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const next = jest.fn();
    const res = mockRes();
    await verifyRecaptcha({ body: { recaptcha: 'token' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(502);
  });
});

describe('verifyGoogleIdToken', () => {
  const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

  function validPayload(overrides = {}) {
    return {
      aud: CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
      email: 'user@example.com',
      email_verified: 'true',
      sub: 'google-sub-123',
      name: 'Test User',
      ...overrides,
    };
  }

  test('throws NOT_CONFIGURED when GOOGLE_CLIENT_ID is missing', async () => {
    await expect(verifyGoogleIdToken('any')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test('throws INVALID when credential is missing', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    await expect(verifyGoogleIdToken('')).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('throws INVALID when tokeninfo rejects the token', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(verifyGoogleIdToken('bad')).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('throws INVALID on audience mismatch', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload({ aud: 'someone-else' }),
    });
    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('throws INVALID on issuer mismatch', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload({ iss: 'https://evil.example.com' }),
    });
    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('throws INVALID on expired token', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload({ exp: String(Math.floor(Date.now() / 1000) - 60) }),
    });
    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('throws UNVERIFIED when the Google email is not verified', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload({ email_verified: 'false' }),
    });
    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({ code: 'UNVERIFIED' });
  });

  test('resolves with the payload for a valid token', async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload(),
    });
    const payload = await verifyGoogleIdToken('token');
    expect(payload.email).toBe('user@example.com');
    expect(payload.sub).toBe('google-sub-123');
  });
});
