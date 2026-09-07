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

function ping(req, res) {
  const creds = auth.parseBasicAuth(req.headers);
  sendJson(res, 200, { systemId: 'S4D', client: auth.SAP_CLIENT, user: creds.userId, time: new Date().toISOString() });
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
  const filters = setName === 'ObjectParameters'
    ? {
        object_name: url.searchParams.get('objectName') || undefined,
        parameter_type: url.searchParams.get('parameterType') || undefined,
        parameter_id: url.searchParams.get('parameterId') || undefined,
      }
    : undefined;
  const { rows, total } = db.listEntities(table, top, skip, filters);
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

module.exports = { sendJson, root, ping, serviceDoc, entityList, entityGet, slow, flaky };
