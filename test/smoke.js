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

    res = await fetch(`${base}/sap/ping`);
    assert.strictEqual(res.status, 400, 'missing sap-client should be 400');
    assert.strictEqual((await res.json()).error.code, 'SAP_CLIENT_INVALID');

    res = await fetch(`${base}/sap/ping?sap-client=100`);
    assert.strictEqual(res.status, 401, 'missing auth should be 401');
    assert.match(res.headers.get('www-authenticate') || '', /Basic realm="xyra-s4"/);

    res = await fetch(`${base}/sap/ping?sap-client=100`, { headers: { Authorization: authHeader } });
    assert.strictEqual(res.status, 200, 'correct client + auth should be 200');

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

    res = await fetch(
      `${base}/sap/opu/odata/xyra/CCM_SRV/ObjectParameters?sap-client=100&objectName=SAP*&parameterType=GENERAL&parameterId=${encodeURIComponent('Password Changed')}`,
      { headers: { Authorization: authHeader } }
    );
    assert.strictEqual(res.status, 200);
    const found = await res.json();
    assert.strictEqual(found.value.length, 1, 'expected exactly one matching ObjectParameters row');
    assert.strictEqual(found.value[0].parameter_value, 'Yes');

    res = await fetch(
      `${base}/sap/opu/odata/xyra/CCM_SRV/ObjectParameters?sap-client=100&objectName=NOBODY&parameterType=GENERAL&parameterId=Locked`,
      { headers: { Authorization: authHeader } }
    );
    assert.strictEqual(res.status, 200);
    const notFound = await res.json();
    assert.strictEqual(notFound.value.length, 0, 'no matching row should still be a 200 with an empty value array');

    console.log('All xyra-s4 smoke checks passed.');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
