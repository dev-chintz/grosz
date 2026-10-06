# grosz

Domowa aplikacja do budżetu: wpływy, wydatki cykliczne (raty, rachunki, abonamenty) i jednorazowe, prognoza salda na cały miesiąc.

Mockup: https://claude.ai/artifact/Ro1Kvgqao6zRbBcuMGq2cz

## Start lokalnie

Wymaga Node 24+.

```bash
npm install
npm run db:migrate
npm run db:seed      # przykładowe dane z mockupu
npm run dev          # http://localhost:5173
```

Lokalnie baza to PGlite (folder `.data/`) — nie trzeba instalować Postgresa ani Dockera.

## Struktura

| Katalog | Co zawiera |
|---|---|
| `shared/` | logika wspólna: daty i polskie święta, silnik terminów cyklicznych, formatowanie kwot |
| `server/` | API (Fastify + Drizzle), schemat bazy i migracje |
| `web/` | interfejs (React + Vite) |
| `deploy/` | wdrożenie i kopie zapasowe na NAS |

## Wdrożenie

Docker na QNAP, PostgreSQL w osobnym kontenerze, aplikacja na porcie 8090 — szczegóły w [`.claude/skills/grosz/references/deploy-qnap.md`](.claude/skills/grosz/references/deploy-qnap.md).

Kontynuacja pracy na innym komputerze (stan, kroki wdrożenia na NAS, zasady pracy): [`docs/HANDOFF.md`](docs/HANDOFF.md).
