# xyra-s4

A fake, local SAP S/4HANA system for testing `xyra-core` and `xyra-web` without
touching a real (and costly) S/4 sandbox. It speaks the same connection contract
a real system would — host/port, HTTP Basic Auth, and a fixed SAP client ID — and
serves a few small CCM-flavored OData-ish endpoints backed by SQLite.

**Not** a real SAP Gateway: no `$metadata` EDMX, no `$filter`/`$expand`/`$select`,
no batch requests. Just enough surface to exercise xyra-core's connection engine
and xyra-web's UI.

## Quick start

```
npm start          # listens on http://localhost:8000 (override with PORT env var)
npm test           # runs the smoke test against an in-process server
```

Default credentials (override with `S4_USER` / `S4_PASSWORD` env vars):

```
user:     XYRA_S4
password: Xyra@12345
client:   100 (fixed - not configurable)
```

## Endpoints

Every protected route checks `sap-client` first, then Basic Auth — a missing or
wrong client is rejected before credentials are even looked at (matches real SAP
behavior, where the client resolves which user master to check against).

| Method | Path | Auth | sap-client | Notes |
|---|---|---|---|---|
| GET | `/` | none | — | Bare reachability check, `200 {"status":"ok",...}` |
| GET | `/sap/ping` | Basic | required | Authenticated ping |
| GET | `/sap/opu/odata/xyra/CCM_SRV/` | Basic | required | Service doc listing entity sets |
| GET | `/sap/opu/odata/xyra/CCM_SRV/{Set}?$top=&$skip=` | Basic | required | List, paginated (default `$top=20`, cap `100`) |
| GET | `/sap/opu/odata/xyra/CCM_SRV/{Set}(<id>)` | Basic | required | Single row, `404` if missing |
| GET | `/sap/test/slow?delayMs=` | Basic | required | Delays response (default `10000`ms, past xyra-core's 8s fetch timeout) |
| GET | `/sap/test/flaky` | Basic | required | ~50% random `500`, for retry-handling tests |

`{Set}` is one of `Users`, `CriticalTransactionLogs`, `GLDocuments`, `ChangeLogs`.

There's no dedicated "wrong client" endpoint — every protected route above already
rejects a bad/missing `sap-client` with a `400`; just omit or mistype the query
param on any of them to see it.

### Error shapes

`400` (bad/missing client):
```json
{"error":{"code":"SAP_CLIENT_INVALID","message":"Query parameter sap-client is required and must equal '100' for this system (got: 'missing')."}}
```

`401` (missing/bad Basic auth), with `WWW-Authenticate: Basic realm="xyra-s4"`:
```json
{"error":{"code":"UNAUTHORIZED","message":"HTTP Basic authentication required (or credentials invalid) for xyra-s4."}}
```

## Data

Seeded once (idempotent) into `data/xyra-s4.sqlite` on first run, covering common
CCM scenarios:

- **Users** — includes `JDOE` with both AP-clerk and AP-approver roles (a
  deliberate SoD conflict) and `MSMITH` with `SAP_ALL` (critical access).
- **CriticalTransactionLogs** — `SU01`/`PFCG`/`SE38`/`SM59`/`SCC4`/`MASS` executions.
- **GLDocuments** — sample postings across two company codes.
- **ChangeLogs** — role/user/GL/client-setting change history.

## Pointing xyra-core at this system

xyra-core's `Systems`/`SystemCredentials` records need these values:

| Field | Value |
|---|---|
| systemId | `S4D` |
| client | `100` |
| hostName | `localhost` |
| port | `8000` |
| clientType | `ABAP` |
| **endpoint** | **`http://localhost:8000`** |
| userId | `XYRA_S4` |
| passwordHash | `Xyra@12345` |
| jwtToken | *(leave empty)* |

The `endpoint` field matters: xyra-core's `connection_engine` hardcodes
`https://` unless `endpoint` is set, and this fake system serves plain `http://`
(no TLS cert setup here). `jwtToken` must stay empty, since `connection_engine`
prefers Bearer over Basic when it's populated — this system only supports Basic.

**Known gap (not fixed by this project):** xyra-core's `createSystem`/
`updateSystem` API and the Configuration UI don't currently accept
`endpoint`/`userId`/`passwordHash` — only landscape metadata. Until that's added,
point an existing Systems row at this fake system manually: create it via the UI
as usual, then patch the row directly in the tenant Postgres DB
(`tenant_xyrademo`) to add `endpoint` and insert a `SystemCredentials` row with
the values above.

## Design notes

- Zero npm dependencies — Node 22.5+'s built-in `node:sqlite` and `node:http` are
  enough for this scope.
- Single fixed client (`100`) and a single fixed credential pair — this is a
  test stub, not a multi-tenant SAP box.
- The SAP client ID is enforced strictly here on purpose: xyra-core's real
  connection engine never actually sends `sap-client` in its outgoing requests
  today (it's only used as a DB lookup key). Hitting any protected endpoint here
  without `?sap-client=100` surfaces that gap rather than silently working around it.
