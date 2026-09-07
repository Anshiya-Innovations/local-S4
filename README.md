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
| GET | `/sap/opu/odata/xyra/CCM_SRV/ObjectParameters?objectName=&parameterType=&parameterId=` | Basic | required | Exact-match lookup (see below) — the one entity set with filtering |
| GET | `/sap/test/slow?delayMs=` | Basic | required | Delays response (default `10000`ms, past xyra-core's 8s fetch timeout) |
| GET | `/sap/test/flaky` | Basic | required | ~50% random `500`, for retry-handling tests |

`{Set}` is one of `Users`, `CriticalTransactionLogs`, `GLDocuments`, `ChangeLogs`,
`ObjectParameters`.

`ObjectParameters` also rides the plain list/get routes above (`$top`/`$skip`,
`(<id>)`) — the three query params are additive exact-match narrowing, xyra-core's
`control_engine` uses them to look up one specific value at a time:
```
GET /sap/opu/odata/xyra/CCM_SRV/ObjectParameters?sap-client=100&objectName=SAP*&parameterType=GENERAL&parameterId=Password%20Changed
→ {"@odata.context":"$metadata#ObjectParameters","@odata.count":1,"value":[{"id":1,"object_name":"SAP*","parameter_type":"GENERAL","parameter_id":"Password Changed","parameter_value":"Yes"}]}
```
A parameter that isn't seeded returns `value: []` with a `200` — a missing value is
meaningful data for `EXISTS`/`NOT_EXISTS` rules, not an error.

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
- **ObjectParameters** — generic `(object_name, parameter_type, parameter_id) ->
  parameter_value` store backing xyra-core's Control Rules feature (SAP*, DDIC,
  SAPCPIC, TMSADM, WF-BATCH, SAP_WFRT, EARLYWATCH, SDMI_*, J2EE_ADMIN, J2EE_GUEST,
  SAPJSF, ADSUSER), with a deliberate mix of compliant and non-compliant values
  (e.g. `SAP*`'s `Roles Assigned` is seeded non-compliant) so a demo Control run
  produces genuine pass/fail results. Independent of the `Users` table above —
  these are service/system accounts being checked for parameter state, not the
  interactive-login SoD fixtures.

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

xyra-core's `SystemConfigService.createSystem`/`updateSystem` actions accept
`endpoint`/`credUserId`/`credPassword` directly, so a Systems row can be pointed
at this fake system through the normal API — no manual DB patch needed.

## Design notes

- Zero npm dependencies — Node 22.5+'s built-in `node:sqlite` and `node:http` are
  enough for this scope.
- Single fixed client (`100`) and a single fixed credential pair — this is a
  test stub, not a multi-tenant SAP box.
- The SAP client ID is enforced strictly here on purpose, matching real SAP
  behavior — xyra-core's `connection_engine`/`control_engine` do send
  `?sap-client=` on every outgoing request.
