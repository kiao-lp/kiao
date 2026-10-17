# hybridflow-store

`operation/hybridflow-store` keeps the boards and the cards on them, in PostgreSQL. It is a
Go service in hexagonal layout, authenticating against the same Keycloak realm as
[worker](/operation/worker/README.md) and with the same realm role, so a caller that
reaches one reaches the other with no second login.

## The documents

- [The schema](/docs/architecture/containers/hybridflow-store/schema.md) — why the boards left
  the store for PostgreSQL, the tables, and the migration history.
- [The board UI](/docs/architecture/containers/hybridflow-store/board-ui.md) — the board's URL,
  the gestures, and what the browser mints, merges and keeps.
- [Interactions](/docs/architecture/containers/hybridflow-store/interactions.md) — how Dashboard,
  worker and this service meet around one card, and on what credential.
- [Configuration and deployment](/docs/architecture/containers/hybridflow-store/deployment.md) —
  the environment variables, and where the service runs in each environment.

## The layout

```
operation/hybridflow-store/
├── core/
│   ├── entities/   boards, cards and their tasks, agents, runners — pure Go, no driver
│   ├── ports/      what the core asks of the outside world
│   └── services/   the rules, written against the ports
├── adapters/
│   ├── postgres/   the ports over PostgreSQL, and the schema migrations
│   ├── httpapi/    the services as a JSON API
│   ├── auth/       Keycloak JWTs — the ones worker accepts
│   └── memory/     the ports in maps: what the tests are written against
├── lib/            logging, httpx, config — what two or more of them share
└── main.go         the composition root, and the only file that knows both halves exist
```

`core/` imports no adapter — not a line — and the tests of it are `package services_test`, holding
the in-memory store. So every rule is checked with no database anywhere near it; the suite that does
need one (`adapters/postgres`) checks the three things only a database can promise.
