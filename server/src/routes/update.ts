// Ustawienia → Aktualizacja: porównanie wersji z GitHubem i zlecenie aktualizacji updaterowi (kontener z Dockerem).

import type { FastifyInstance } from 'fastify';
import type { UpdateStatusResponse } from '@grosz/shared/api';

const REPO = process.env.GITHUB_REPO ?? 'dev-chintz/grosz';
const UPDATER_URL = process.env.UPDATER_URL ?? 'http://updater:8080';
const currentCommit = () => {
  const sha = process.env.GIT_COMMIT?.trim();
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
};

// GitHub bez tokenu pozwala na 60 zapytań/h — wynik trzymamy minutę.
let cache: { at: number; value: Pick<UpdateStatusResponse, 'latest' | 'behind' | 'changes' | 'checkError'> } | null = null;

async function checkGithub(current: string | null) {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'grosz-updater' };
  const get = async (path: string) => {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GitHub odpowiedział ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  type Commit = { sha: string; commit: { message: string; author: { date: string } } };
  const toChange = (c: Commit) => ({ sha: c.sha, message: c.commit.message.split('\n')[0]!, date: c.commit.author.date });
  let value: Pick<UpdateStatusResponse, 'latest' | 'behind' | 'changes' | 'checkError'>;
  try {
    if (current) {
      const compare = (await get(`compare/${current}...main`)) as { ahead_by: number; commits: Commit[] };
      const changes = compare.commits.map(toChange).reverse();
      const head = changes[0] ?? null;
      value = { latest: head ?? { sha: current, message: '', date: '' }, behind: compare.ahead_by, changes: changes.slice(0, 20), checkError: null };
    } else {
      const head = toChange((await get('commits/main')) as Commit);
      value = { latest: head, behind: null, changes: [], checkError: null };
    }
  } catch (error) {
    value = { latest: null, behind: null, changes: [], checkError: (error as Error).message };
  }
  cache = { at: Date.now(), value };
  return value;
}

async function callUpdater(path: string, method: 'GET' | 'POST') {
  const token = process.env.UPDATER_TOKEN?.trim();
  if (!token) return null;
  const res = await fetch(`${UPDATER_URL}${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function registerUpdateRoutes(app: FastifyInstance) {
  app.get('/api/update/status', async (): Promise<UpdateStatusResponse> => {
    const current = currentCommit();
    const github = await checkGithub(current);
    let updater: UpdateStatusResponse['updater'] = { configured: !!process.env.UPDATER_TOKEN?.trim(), reachable: false, state: null };
    if (updater.configured) {
      try {
        const res = await callUpdater('/status', 'GET');
        if (res?.status === 200) updater = { configured: true, reachable: true, state: res.body as unknown as NonNullable<UpdateStatusResponse['updater']['state']> };
      } catch {
        // updater nie odpowiada — karta pokaże, że aktualizacja z przycisku jest niedostępna
      }
    }
    return { current, ...github, updater };
  });

  app.post('/api/update', async (_request, reply) => {
    const res = await callUpdater('/update', 'POST').catch(() => undefined);
    if (res === null) return reply.code(409).send({ error: 'Aktualizacja z przycisku nie jest skonfigurowana (brak UPDATER_TOKEN).' });
    if (!res) return reply.code(502).send({ error: 'Updater nie odpowiada.' });
    if (res.status === 409) return reply.code(409).send({ error: 'Aktualizacja już trwa.' });
    if (res.status !== 202) return reply.code(502).send({ error: `Updater odpowiedział ${res.status}.` });
    cache = null;
    app.log.info('Zlecono aktualizację z Ustawień.');
    return reply.code(202).send({ ok: true });
  });
}
