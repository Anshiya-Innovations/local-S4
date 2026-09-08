'use strict';
const db = require('./db');
const auth = require('./auth');

function sendJson(res, status, body, extraHeaders) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

// Unauthenticated - mirrors real SAP: hitting the bare host:port serves a plain
// availability page without needing client/auth. This is what xyra-core's
// current bare-GET reachability check hits.
function root(req, res) {
  sendJson(res, 200, { status: 'ok', system: 'XYRA-S4-FAKE', time: new Date().toISOString() });
}

// Real, standard, unauthenticated SAP ICM reachability check - present on any
// real NetWeaver/S4 system, no custom development needed. Body content is
// irrelevant (connection_engine only checks the HTTP status).
function publicPing(req, res) {
  sendJson(res, 200, { status: 'ok' });
}

// Real, standard SAP Gateway service catalog (/IWFND/CATALOGSERVICE;v=2) -
// present on any Gateway-enabled system with zero custom development. This is
// the one endpoint connection_engine's testConnection actually needs
// authenticated + sap-client-checked, so it doubles as the local stand-in for
// that real check (see routes in server.js) - no separate test-only endpoint
// invented for this. Minimal but shape-correct: the real catalog lists every
// registered OData service on the system; only the fact that a 200 comes back
// (proving valid Basic Auth + sap-client) matters to callers.
function catalogService(req, res) {
  sendJson(res, 200, { d: { results: [{ ID: 'ZXYRA_CCM_SRV', Version: '0002' }] } });
}

function serviceDoc(req, res) {
  sendJson(res, 200, {
    '@odata.context': '$metadata',
    value: Object.keys(db.ENTITY_SETS).map((name) => ({ name, url: name })),
  });
}

function entityList(req, res, url, match) {
  const setName = match[1];
  const table = db.ENTITY_SETS[setName];
  const top = Math.min(parseInt(url.searchParams.get('$top'), 10) || 20, 100);
  const skip = parseInt(url.searchParams.get('$skip'), 10) || 0;
  const { rows, total } = db.listEntities(table, top, skip);
  const body = {
    '@odata.context': `$metadata#${setName}`,
    '@odata.count': total,
    value: rows,
  };
  if (skip + rows.length < total) {
    body['@odata.nextLink'] = `${setName}?$top=${top}&$skip=${skip + top}`;
  }
  sendJson(res, 200, body);
}

// Real, minimal OData V2 GET: only understands the exact 3-clause "Field eq
// 'value' and Field eq 'value' and Field eq 'value'" shape control_engine
// ever sends (ObjectName, ParameterType, ParameterId, in that order) - not a
// general OData filter grammar. Anything else is a 400, not a silent
// misparse. Response is the real, unconfigurable OData V2 JSON envelope
// {"d":{"results":[...]}} - empty results + HTTP 200 for "no match", never a
// 404, matching real Gateway semantics (EXISTS/NOT_EXISTS rules depend on
// "not found" being a normal, non-error outcome).
const OBJECT_PARAMETER_FILTER_RE =
  /^ObjectName eq '((?:[^']|'')*)' and ParameterType eq '((?:[^']|'')*)' and ParameterId eq '((?:[^']|'')*)'$/;

function unescapeODataLiteral(value) {
  return value.replace(/''/g, "'");
}

function objectParameterSet(req, res, url) {
  const filter = (url.searchParams.get('$filter') || '').trim();
  const match = OBJECT_PARAMETER_FILTER_RE.exec(filter);
  if (!match) {
    return sendJson(res, 400, {
      error: {
        code: 'UNSUPPORTED_FILTER',
        message: "This reference implementation only supports $filter=ObjectName eq '...' and ParameterType eq '...' and ParameterId eq '...' (in that exact order).",
      },
    });
  }

  const objectName = unescapeODataLiteral(match[1]);
  const parameterType = unescapeODataLiteral(match[2]);
  const parameterId = unescapeODataLiteral(match[3]);
  const rows = db.getObjectParameter(objectName, parameterType, parameterId).map((row) => ({
    ObjectName: row.object_name,
    ParameterType: row.parameter_type,
    ParameterId: row.parameter_id,
    ParameterValue: row.parameter_value,
  }));

  sendJson(res, 200, { d: { results: rows } });
}

function entityGet(req, res, url, match) {
  const setName = match[1];
  const id = match[2];
  const table = db.ENTITY_SETS[setName];
  const row = db.getEntity(table, id);
  if (!row) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `${setName}(${id}) not found.` } });
  }
  sendJson(res, 200, row);
}

// Deliberately exceeds xyra-core's 8000ms fetch timeout by default, to exercise
// timeout/retry handling on the caller side.
function slow(req, res, url) {
  const delayMs = Math.min(parseInt(url.searchParams.get('delayMs'), 10) || 10000, 60000);
  setTimeout(() => sendJson(res, 200, { delayedMs: delayMs, message: 'finally responded' }), delayMs);
}

function flaky(req, res) {
  if (Math.random() < 0.5) {
    return sendJson(res, 500, { error: { code: 'INTERNAL_FLAKY', message: 'Simulated transient failure - retry.' } });
  }
  sendJson(res, 200, { ok: true });
}

module.exports = { sendJson, root, publicPing, catalogService, serviceDoc, entityList, entityGet, objectParameterSet, slow, flaky };
