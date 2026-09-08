'use strict';
const http = require('node:http');
const { requireClient, requireAuth } = require('./lib/auth');
const handlers = require('./lib/handlers');

const PORT = process.env.PORT || 8000;
const ENTITY_SET_NAMES = 'Users|CriticalTransactionLogs|GLDocuments|ChangeLogs';

// [method, path pattern, handler, protected] - protected routes need sap-client=100 + Basic auth.
// /sap/public/ping and the Gateway catalog service are real, standard SAP
// endpoints (see connection_engine.testConnection) - no custom-service
// fiction here. /sap/opu/odata/sap/ZXYRA_CCM_SRV/ObjectParameterSet is the
// one custom Z-service a real ABAP team would build (see
// xyra-core/docs/Z-ODATA-INTEGRATION-SPEC.md) - this is xyra-s4's faithful
// local reference implementation of that exact contract.
const routes = [
  ['GET', /^\/$/, handlers.root, false],
  ['GET', /^\/sap\/public\/ping$/, handlers.publicPing, false],
  ['GET', /^\/sap\/opu\/odata\/iwfnd\/catalogservice;v=2\/ServiceCollection$/, handlers.catalogService, true],
  ['GET', /^\/sap\/opu\/odata\/xyra\/CCM_SRV\/?$/, handlers.serviceDoc, true],
  ['GET', new RegExp(`^/sap/opu/odata/xyra/CCM_SRV/(${ENTITY_SET_NAMES})\\((.+)\\)$`), handlers.entityGet, true],
  ['GET', new RegExp(`^/sap/opu/odata/xyra/CCM_SRV/(${ENTITY_SET_NAMES})$`), handlers.entityList, true],
  ['GET', /^\/sap\/opu\/odata\/sap\/ZXYRA_CCM_SRV\/ObjectParameterSet$/, handlers.objectParameterSet, true],
  ['GET', /^\/sap\/test\/slow$/, handlers.slow, true],
  ['GET', /^\/sap\/test\/flaky$/, handlers.flaky, true],
];

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) {
      return handlers.sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${url.pathname}` },
      });
    }
    const [, pattern, handler, isProtected] = route;
    if (isProtected) {
      const clientErr = requireClient(url.searchParams);
      if (clientErr) return handlers.sendJson(res, clientErr.status, clientErr.body);
      const authErr = requireAuth(req.headers);
      if (authErr) return handlers.sendJson(res, authErr.status, authErr.body, authErr.headers);
    }
    handler(req, res, url, pattern.exec(url.pathname));
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`xyra-s4 fake SAP system listening on http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
