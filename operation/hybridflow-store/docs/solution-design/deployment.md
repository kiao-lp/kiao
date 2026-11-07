# hybridflow-store — configuration and deployment

## Configuration

| variable | default | what it is |
| --- | --- | --- |
| `KIAO_HYBRIDFLOW_STORE_PORT` | `18081` | beside worker's `18080` |
| `KIAO_HYBRIDFLOW_STORE_DATABASE_URL` | — | required; no default, because guessing `localhost` would be a production instance writing into a developer's database |
| `KIAO_HYBRIDFLOW_STORE_MAX_CONNS` | `8` | small on purpose: short queries, a 1-vCPU server |
| `KIAO_HYBRIDFLOW_STORE_AUTH_MODE` | `prod` | or `debug`, which permits everything and says so loudly |
| `KIAO_KEYCLOAK_ISSUER_URI` | — | **worker's own variable name**, deliberately |
| `KIAO_KEYCLOAK_JWK_SET_URI` | — | likewise |
| `KIAO_HYBRIDFLOW_STORE_CHANGE_RETENTION_HOURS` | `72` | the change log is a cursor, not an archive |
| `KIAO_HYBRIDFLOW_STORE_WATCH_TIMEOUT_SECONDS` | `25` | how long `GET /changes?wait=1` holds a request |
| `KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN` | — | the Bearer [REDACTED] deployment's own services present; the same value goes in worker's `KIAO_WORKER_HYBRIDFLOW_TOKEN` |
| `KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS` | — | comma-separated; no wildcard with credentials |

The two Keycloak variables are read under worker's names on purpose: "authentication
compatible with worker" means the same realm, the same tokens and the same two lines of the
same environment file — not a similar scheme. The one thing not carried over is the
`files_reader` role: it exists so read-only clients can download files, and there is nothing here
for them to read.

## Where it runs

Three ways to run it, one service, and the difference between them is two lines of environment.

**One service, one set of boards.** Where the boards live is one place at a time: an
instance either runs its own store beside its worker, against a database of its own, or is
a client of a shared service over HTTPS.

| | where its boards are | what puts `/api/hybridflow` in front of the SPA |
| --- | --- | --- |
| **the `kiao` image** | its own PostgreSQL in the container, through the bundled store beside worker | nginx (`proxy_buffering off`) |
| **`kiao`, the installed executable** | the shared service over HTTPS, named by `KIAO_WORKER_HYBRIDFLOW_URL` | the launcher's own front server — `bin/kiao-launcher/web.go` |
| **`bin/local-start-kiao.sh`, for development** | likewise | the vite dev server's proxy |

An executable or local-start instance may instead be pointed at a **database** of its own, with
`KIAO_HYBRIDFLOW_STORE_DATABASE_URL`, and then it starts a hybridflow-store beside its
worker. That is for developing against something that is not production; setting both is
refused at startup, because they are two different places to write a card to and they look
identical from the screen.

In all of them the SPA calls an **origin-relative `/api/hybridflow`**, so the same bundle is correct
everywhere and nothing in it names a host. Two things must be true of whatever sits in front:

- it **does not buffer** — `GET /changes?wait=1` is held open until something on the board changes,
  and a buffering proxy delivers the answer late or in a lump, which reads as a board that does not
  move when a run marks a card;
- when the service is elsewhere, **it adds the credential**. A local instance has no Keycloak
  session to borrow: its SPA is built with `VITE_NO_SECURITY`. So the proxy presents the
  deployment's service token and names the user in `X-Kiao-Actor`, which is the one way a card
  moved from a laptop says who moved it. The token never reaches the browser.

### One list, every environment

The boards of every environment are in one list, and nothing on a board says which store or which
machine it was made for. Accepted for now: it is the price of one place where the boards are. A
board that belongs to a store is a decision that has not been made.
