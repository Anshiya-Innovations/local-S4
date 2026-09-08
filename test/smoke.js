'use strict';
const assert = require('node:assert');
const { createServer } = require('../server');

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const authHeader = 'Basic ' + Buffer.from('XYRA_S4:Xyra@12345').toString('base64');

  try {
    let res = await fetch(`${base}/`);
    assert.strictEqual(res.status, 200, 'root reachability check should be 200');

    res = await fetch(`${base}/sap/public/ping`);
    assert.strictEqual(res.status, 200, 'real, unauthenticated ICM ping should be 200, no client/auth needed');

    const catalogUrl = `${base}/sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection`;
    res = await fetch(`${catalogUrl}`);
    assert.strictEqual(res.status, 400, 'missing sap-client should be 400');
    assert.strictEqual((await res.json()).error.code, 'SAP_CLIENT_INVALID');

    res = await fetch(`${catalogUrl}?sap-client=100`);
    assert.strictEqual(res.status, 401, 'missing auth should be 401');
    assert.match(res.headers.get('www-authenticate') || '', /Basic realm="xyra-s4"/);

    res = await fetch(`${catalogUrl}?sap-client=100`, { headers: { Authorization: authHeader } });
    assert.strictEqual(res.status, 200, 'correct client + auth should be 200 from the real Gateway catalog service');

    res = await fetch(`${base}/sap/opu/odata/xyra/CCM_SRV/Users?sap-client=100&$top=2`, {
      headers: { Authorization: authHeader },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.value.length, 2, 'expected $top=2 to limit to 2 rows');
    assert.ok(body['@odata.nextLink'], 'expected @odata.nextLink when more rows remain');

    res = await fetch(`${base}/sap/opu/odata/xyra/CCM_SRV/Users?sap-client=800`, {
      headers: { Authorization: authHeader },
    });
    assert.strictEqual(res.status, 400, 'wrong sap-client should be rejected even with valid auth');

    const objectParameterSetUrl = `${base}/sap/opu/odata/sap/ZXYRA_CCM_SRV/ObjectParameterSet`;

    function odataFilter(objectName, parameterType, parameterId) {
      const esc = (v) => v.replace(/'/g, "''");
      return `ObjectName eq '${esc(objectName)}' and ParameterType eq '${esc(parameterType)}' and ParameterId eq '${esc(parameterId)}'`;
    }

    res = await fetch(
      `${objectParameterSetUrl}?sap-client=100&$filter=${encodeURIComponent(odataFilter('SAP*', 'GENERAL', 'Password Changed'))}&$format=json`,
      { headers: { Authorization: authHeader } }
    );
    assert.strictEqual(res.status, 200);
    const found = await res.json();
    assert.strictEqual(found.d.results.length, 1, 'expected exactly one matching row in the real d.results envelope');
    assert.strictEqual(found.d.results[0].ParameterValue, 'Yes');

    res = await fetch(
      `${objectParameterSetUrl}?sap-client=100&$filter=${encodeURIComponent(odataFilter('NOBODY', 'GENERAL', 'Locked'))}&$format=json`,
      { headers: { Authorization: authHeader } }
    );
    assert.strictEqual(res.status, 200);
    const notFound = await res.json();
    assert.strictEqual(notFound.d.results.length, 0, 'no matching row should still be a 200 with an empty results array, never a 404');

    // A value containing a literal apostrophe round-trips correctly through
    // OData V2's escape-by-doubling rule (client doubles it building the
    // filter, server un-doubles it parsing the filter).
    res = await fetch(
      `${objectParameterSetUrl}?sap-client=100&$filter=${encodeURIComponent(odataFilter("O'Brien", 'GENERAL', 'Locked'))}&$format=json`,
      { headers: { Authorization: authHeader } }
    );
    assert.strictEqual(res.status, 200, 'an embedded single quote should not break filter parsing');
    assert.strictEqual((await res.json()).d.results.length, 0, 'no such row seeded, but the request itself must parse cleanly');

    res = await fetch(`${objectParameterSetUrl}?sap-client=100&$filter=garbage&$format=json`, { headers: { Authorization: authHeader } });
    assert.strictEqual(res.status, 400, 'an unsupported $filter shape should be a 400, not a silent misparse');
    assert.strictEqual((await res.json()).error.code, 'UNSUPPORTED_FILTER');

    console.log('All xyra-s4 smoke checks passed.');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
