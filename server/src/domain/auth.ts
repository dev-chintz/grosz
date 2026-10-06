import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { currentHouseholdId } from './household.ts';

export const SESSION_COOKIE = 'grosz_session';
export const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  householdId: string;
  name: string;
  login: string;
}

export class AuthError extends Error {
  readonly statusCode: number;
  readonly errors?: Record<string, string>;
  constructor(statusCode: number, message: string, errors?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeLogin = (login: string) => login.trim().toLocaleLowerCase('pl');

export function validateCredentials(login: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[a-z0-9._-]{3,40}$/.test(normalizeLogin(login))) errors.login = 'Login: 3–40 znaków — litery, cyfry, kropka, myślnik, podkreślnik.';
  if (password.length < 10) errors.password = 'Hasło musi mieć co najmniej 10 znaków.';
  else if (password.length > 200) errors.password = 'Hasło może mieć najwyżej 200 znaków.';
  return errors;
}

// ---------- kod pierwszego uruchomienia ----------

/**
 * Dopóki nikt nie ma hasła, konto zakłada się ekranem „Pierwsze uruchomienie”. Żeby nie zrobił tego
 * pierwszy lepszy w sieci, wymagamy kodu wypisywanego w logach serwera (dostęp ma tylko właściciel NAS-a).
 * Nowy kod przy każdym starcie; po założeniu konta przestaje działać.
 */
let setupCode: string | null = null;

export function issueSetupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  setupCode = `${part()}-${part()}`;
  return setupCode;
}

export async function setupRequired(db: Db): Promise<boolean> {
  const [withPassword] = await db.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).limit(1);
  return !withPassword;
}

const sameCode = (given: string, expected: string) => {
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Zakłada pierwsze konto: nadaje login i hasło pierwszej osobie gospodarstwa (z bootstrapu: „Ja”). */
export async function completeSetup(db: Db, input: { code: string; name: string; login: string; password: string }): Promise<string> {
  if (!(await setupRequired(db))) throw new AuthError(409, 'Konto już istnieje — zaloguj się.');
  if (!setupCode || !sameCode(input.code, setupCode)) throw new AuthError(400, 'Popraw zaznaczone pola.', { code: 'Nieprawidłowy kod. Sprawdź logi aplikacji na NAS.' });
  const errors = validateCredentials(input.login, input.password);
  if (!input.name.trim()) errors.name = 'Podaj imię.';
  if (Object.keys(errors).length) throw new AuthError(400, 'Popraw zaznaczone pola.', errors);

  const householdId = await currentHouseholdId(db);
  if (!householdId) throw new AuthError(409, 'Brak budżetu — uruchom najpierw bootstrap.');
  const [first] = await db.select({ id: users.id }).from(users).where(eq(users.householdId, householdId)).orderBy(asc(users.createdAt)).limit(1);
  const values = { name: input.name.trim(), login: normalizeLogin(input.login), passwordHash: await hashPassword(input.password) };
  const userId = first
    ? (await db.update(users).set(values).where(eq(users.id, first.id)).returning({ id: users.id }))[0]!.id
    : (await db.insert(users).values({ ...values, householdId }).returning({ id: users.id }))[0]!.id;
  setupCode = null;
  return userId;
}

// ---------- ograniczenie prób logowania ----------

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; firstAt: number; until: number }>();

function checkLock(key: string) {
  const entry = failures.get(key);
  if (entry && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60_000);
    throw new AuthError(429, `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${minutes} min.`);
  }
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = failures.get(key);
  // Liczymy próby w oknie 15 minut od pierwszej nieudanej; po blokadzie okno zaczyna się od nowa.
  const fresh = !entry || now - entry.firstAt > LOCK_MS;
  const count = fresh ? 1 : entry.count + 1;
  if (failures.size > 10_000) failures.clear(); // zabezpieczenie pamięci przed zalewem losowych loginów
  failures.set(key, { count, firstAt: fresh ? now : entry.firstAt, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
}

/** Zwraca id użytkownika albo rzuca 401/429. Ten sam komunikat dla złego loginu i złego hasła. */
export async function checkLogin(db: Db, login: string, password: string, ip: string): Promise<string> {
  const normalized = normalizeLogin(login);
  const key = `${ip}|${normalized}`;
  checkLock(key);
  const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.login, normalized));
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    recordFailure(key);
    throw new AuthError(401, 'Nieprawidłowy login lub hasło.');
  }
  failures.delete(key);
  return user.id;
}

/** Tylko dla testów: czyści licznik nieudanych prób. */
export const resetLoginFailures = () => failures.clear();

// ---------- sesje ----------

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
  // Przy okazji sprzątamy wygasłe sesje.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return token;
}

export async function findSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, householdId: users.householdId, name: users.name, login: users.login })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), isNotNull(users.passwordHash)));
  return row?.login ? { ...row, login: row.login } : null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function changePassword(db: Db, userId: string, current: string, next: string, keepToken: string): Promise<void> {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    throw new AuthError(400, 'Popraw zaznaczone pola.', { current: 'Obecne hasło jest nieprawidłowe.' });
  }
  const errors = validateCredentials('placeholder', next);
  if (errors.password) throw new AuthError(400, 'Popraw zaznaczone pola.', { next: errors.password });
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  // Zmiana hasła wylogowuje pozostałe urządzenia; bieżąca sesja zostaje.
  const all = await db.select({ id: sessions.id, tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.tokenHash !== sha256(keepToken)) await db.delete(sessions).where(eq(sessions.id, s.id));
}
