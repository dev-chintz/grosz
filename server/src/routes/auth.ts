import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import {
  changePassword,
  checkLogin,
  completeSetup,
  createSession,
  deleteSession,
  findSessionUser,
  issueSetupCode,
  SESSION_COOKIE,
  SESSION_DAYS,
  setupRequired,
  type SessionUser,
} from '../domain/auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** Trasy dostępne bez logowania. Cała reszta /api/* wymaga ważnej sesji. */
const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup']);

const readCookie = (request: FastifyRequest) => {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
};

// httpOnly: skrypt na stronie nie odczyta tokenu; SameSite=Strict: inne strony nie wyślą żądania z naszą sesją.
// Bez Secure, bo w domu aplikacja działa po http; przy https (np. reverse proxy) przeglądarka i tak go przyjmie.
const setSessionCookie = (reply: FastifyReply, token: string) =>
  reply.header('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86_400}`);
const clearSessionCookie = (reply: FastifyReply) => reply.header('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

const str = { type: 'string', maxLength: 200 } as const;

export function registerAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('user', null);

  // Kod sprawdzamy w tle — buildApp jest synchroniczne, a zapytanie trwa milisekundy.
  void setupRequired(db).then((required) => {
    if (required) app.log.warn(`Brak konta. Kod pierwszego uruchomienia: ${issueSetupCode()} (wpisz go na ekranie „Pierwsze uruchomienie”).`);
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
    const token = readCookie(request);
    const user = token ? await findSessionUser(db, token) : null;
    if (!user) return reply.code(401).send({ error: 'Zaloguj się.' });
    request.user = user;
  });

  app.get('/api/auth/status', async (request) => {
    const token = readCookie(request);
    const user = token ? await findSessionUser(db, token) : null;
    return { authenticated: !!user, user: user && { id: user.id, name: user.name, login: user.login }, setupRequired: await setupRequired(db) };
  });

  app.post<{ Body: { code: string; name: string; login: string; password: string } }>(
    '/api/auth/setup',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['code', 'name', 'login', 'password'], properties: { code: str, name: str, login: str, password: str } } } },
    async (request, reply) => {
      const userId = await completeSetup(db, request.body);
      setSessionCookie(reply, await createSession(db, userId));
      app.log.info('Założono pierwsze konto.');
      return { ok: true };
    },
  );

  app.post<{ Body: { login: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['login', 'password'], properties: { login: str, password: str } } } },
    async (request, reply) => {
      const userId = await checkLogin(db, request.body.login, request.body.password, request.ip);
      setSessionCookie(reply, await createSession(db, userId));
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readCookie(request);
    if (token) await deleteSession(db, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post<{ Body: { current: string; next: string } }>(
    '/api/auth/password',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['current', 'next'], properties: { current: str, next: str } } } },
    async (request) => {
      await changePassword(db, request.user!.id, request.body.current, request.body.next, readCookie(request)!);
      return { ok: true };
    },
  );
}
