# xyra-s4

A fake, local SAP S/4HANA system for testing `xyra-core` and `xyra-web` without
touching a real (and costly) S/4 sandbox. It speaks the same connection contract
a real system would — host/port, HTTP Basic Auth, and a fixed SAP client ID.

Two categories of endpoint here, deliberately at different fidelity levels:

- **Real, standard SAP endpoints** — `/sap/public/ping` and the Gateway service
  catalog (`/sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection`) are
  genuine, standard SAP paths present on any real system with zero custom
  development. `xyra-core`'s connection test uses these directly, so pointing
  it at a real S/4 system needs no code change for reachability/credential
  checks.
- **`ObjectParameterSet`** — a real, minimal OData V2 GET-with-`$filter`
  contract (`{"d":{"results":[...]}}` envelope, standard `eq`/`and` filter
  syntax) that a real customer would implement as a custom Z-service via SAP
  Gateway (SEGW/RAP). This is xyra-s4's **faithful reference implementation**
  of that exact contract — see
  [`xyra-core/docs/Z-ODATA-INTEGRATION-SPEC.md`](../xyra-core/docs/Z-ODATA-INTEGRATION-SPEC.md)
  for the full specification handed to a real ABAP/Basis team. Its `$filter`
  parser is deliberately narrow (only the one 3-clause shape `control_engine`
  ever sends), not a general OData grammar.
- Everything else (`Users`, `CriticalTransactionLogs`, `GLDocuments`,
  `ChangeLogs` — not used by `control_engine` today) stays a simplified
  `$top`/`$skip` stand-in, no `$metadata` EDMX, no general `$filter`/`$expand`/
  `$select`. Just enough surface for other future testing, not a full Gateway
  simulator.

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
| GET | `/sap/public/ping` | none | — | Real, standard, unauthenticated SAP ICM ping |
| GET | `/sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection` | Basic | required | Real, standard SAP Gateway service catalog — validates credentials |
| GET | `/sap/opu/odata/xyra/CCM_SRV/` | Basic | required | Service doc listing the 4 simplified entity sets below |
| GET | `/sap/opu/odata/xyra/CCM_SRV/{Set}?$top=&$skip=` | Basic | required | List, paginated (default `$top=20`, cap `100`) |
| GET | `/sap/opu/odata/xyra/CCM_SRV/{Set}(<id>)` | Basic | required | Single row, `404` if missing |
| GET | `/sap/opu/odata/sap/ZXYRA_CCM_SRV/ObjectParameterSet?$filter=...` | Basic | required | Real OData V2 `$filter` lookup (see below) |
| GET | `/sap/test/slow?delayMs=` | Basic | required | Delays response (default `10000`ms, past xyra-core's 8s fetch timeout) |
| GET | `/sap/test/flaky` | Basic | required | ~50% random `500`, for retry-handling tests |

`{Set}` is one of `Users`, `CriticalTransactionLogs`, `GLDocuments`, `ChangeLogs`.

`ObjectParameterSet` speaks real OData V2: a standard `$filter` of 3 ANDed `eq`
clauses (only shape supported — anything else is a `400 UNSUPPORTED_FILTER`,
not a silent misparse) and the real, unconfigurable `{"d":{"results":[...]}}`
envelope:
```
GET /sap/opu/odata/sap/ZXYRA_CCM_SRV/ObjectParameterSet?sap-client=100&$filter=ObjectName eq 'SAP*' and ParameterType eq 'GENERAL' and ParameterId eq 'Password Changed'&$format=json
→ {"d":{"results":[{"ObjectName":"SAP*","ParameterType":"GENERAL","ParameterId":"Password Changed","ParameterValue":"Yes"}]}}
```
A parameter that isn't seeded returns `{"d":{"results":[]}}` with a `200` — a
missing value is meaningful data for `EXISTS`/`NOT_EXISTS` rules, not an error.
An embedded single quote in a filter value is escaped by doubling it (`'` →
`''`), standard OData V2 literal escaping.

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
- **ObjectParameterSet** — generic `(object_name, parameter_type, parameter_id) ->
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
