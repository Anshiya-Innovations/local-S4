'use strict';
// ponytail: one fixed service-account pair, not a DB-backed user table - this is
// a single-client fake system, not a real multi-user SAP box.
const S4_USER = process.env.S4_USER || 'XYRA_S4';
const S4_PASSWORD = process.env.S4_PASSWORD || 'Xyra@12345';
const SAP_CLIENT = '100';

function requireClient(searchParams) {
  const client = searchParams.get('sap-client');
  if (client !== SAP_CLIENT) {
    return {
      status: 400,
      body: {
        error: {
          code: 'SAP_CLIENT_INVALID',
          message: `Query parameter sap-client is required and must equal '100' for this system (got: '${client ?? 'missing'}').`,
        },
      },
    };
  }
  return null;
}

function parseBasicAuth(headers) {
  const header = headers['authorization'];
  if (!header || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return { userId: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

function requireAuth(headers) {
  const creds = parseBasicAuth(headers);
  if (!creds || creds.userId !== S4_USER || creds.password !== S4_PASSWORD) {
    return {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="xyra-s4"' },
      body: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'HTTP Basic authentication required (or credentials invalid) for xyra-s4.',
        },
      },
    };
  }
  return null;
}

module.exports = { requireClient, parseBasicAuth, requireAuth, S4_USER, S4_PASSWORD, SAP_CLIENT };
