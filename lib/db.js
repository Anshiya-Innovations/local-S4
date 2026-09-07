'use strict';
// SQLite storage for the fake S4 system: node:sqlite is stdlib in Node 22.5+,
// so this needs zero npm dependencies.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'xyra-s4.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    department TEXT,
    roles TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS critical_transaction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tcode TEXT NOT NULL,
    tcode_desc TEXT,
    executed_at TEXT NOT NULL,
    terminal TEXT,
    is_critical INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS gl_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_number TEXT NOT NULL,
    company_code TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    posting_date TEXT NOT NULL,
    gl_account TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    doc_type TEXT,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS change_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_class TEXT NOT NULL,
    object_id TEXT NOT NULL,
    table_name TEXT,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    change_type TEXT NOT NULL
  );

  -- Generic key/value store backing xyra-core's Control Rules feature: a rule
  -- says "for object X, parameter type T, parameter P, expect value V" — this
  -- one table answers "what's the actual value of (X, T, P) right now?" for
  -- ALL three parameter types (GENERAL/SETGET/DEFAULT) uniformly, the same way
  -- real SAP's USR05/parameter-ID mechanism works. Independent of the 'users'
  -- table above: object_name here is mostly SAP's standard default/service
  -- accounts (SAP*, DDIC, ...) being checked for parameter/policy state, a
  -- different rule domain than the SoD/critical-tcode login fixtures.
  CREATE TABLE IF NOT EXISTS object_parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_name TEXT NOT NULL,
    parameter_type TEXT NOT NULL,
    parameter_id TEXT NOT NULL,
    parameter_value TEXT NOT NULL,
    UNIQUE(object_name, parameter_type, parameter_id)
  );
`);

function seedIfEmpty(table, insertSql, rows) {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
  if (count > 0) return;
  const stmt = db.prepare(insertSql);
  for (const row of rows) stmt.run(...row);
}

seedIfEmpty(
  'users',
  `INSERT INTO users (user_id, full_name, email, department, roles, is_locked, last_login)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [
    // JDOE holds both AP-clerk and AP-approver roles - a deliberate SoD conflict for rule testing.
    ['JDOE', 'Jane Doe', 'jdoe@xyra.test', 'Finance', 'Z_FI_AP_CLERK,Z_FI_AP_APPROVER', 0, '2026-08-20T09:12:00Z'],
    ['MSMITH', 'Mark Smith', 'msmith@xyra.test', 'IT', 'SAP_ALL', 0, '2026-08-21T14:03:00Z'],
    ['ARAJU', 'Anita Raju', 'araju@xyra.test', 'Sales', 'Z_SD_ORDER_CLERK', 0, '2026-08-22T08:47:00Z'],
    ['RFC_XYRA', 'RFC Service User', null, 'IT', 'Z_RFC_READONLY', 0, null],
    ['PBROWN', 'Paul Brown', 'pbrown@xyra.test', 'HR', 'Z_HR_ADMIN', 1, '2026-07-30T11:00:00Z'],
    ['KPATEL', 'Kiran Patel', 'kpatel@xyra.test', 'HR', 'Z_HR_CLERK', 0, '2026-08-24T10:15:00Z'],
  ]
);

seedIfEmpty(
  'critical_transaction_logs',
  `INSERT INTO critical_transaction_logs (user_id, tcode, tcode_desc, executed_at, terminal, is_critical)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [
    ['MSMITH', 'SU01', 'Maintain Users', '2026-08-21T14:05:00Z', 'WS-001', 1],
    ['MSMITH', 'PFCG', 'Role Maintenance', '2026-08-21T14:10:00Z', 'WS-001', 1],
    ['JDOE', 'SE38', 'ABAP Editor', '2026-08-20T09:20:00Z', 'WS-014', 1],
    ['RFC_XYRA', 'SM59', 'RFC Destinations', '2026-08-19T02:00:00Z', 'BATCH-01', 1],
    ['MSMITH', 'SCC4', 'Client Administration', '2026-08-22T16:30:00Z', 'WS-001', 1],
    ['ARAJU', 'MASS', 'Mass Maintenance', '2026-08-22T09:00:00Z', 'WS-022', 0],
  ]
);

seedIfEmpty(
  'gl_documents',
  `INSERT INTO gl_documents (doc_number, company_code, fiscal_year, posting_date, gl_account, amount, currency, doc_type, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    ['5000000001', '1000', 2026, '2026-08-10', '400000', 1250.00, 'USD', 'KR', 'JDOE'],
    ['5000000002', '1000', 2026, '2026-08-12', '210000', 8600.50, 'USD', 'KZ', 'JDOE'],
    ['5000000003', '2000', 2026, '2026-08-15', '400000', 320.75, 'EUR', 'KR', 'ARAJU'],
    ['5000000004', '1000', 2026, '2026-08-18', '210000', 15000.00, 'USD', 'KZ', 'MSMITH'],
    ['5000000005', '2000', 2026, '2026-08-20', '400000', 990.00, 'EUR', 'KR', 'KPATEL'],
  ]
);

seedIfEmpty(
  'change_logs',
  `INSERT INTO change_logs (object_class, object_id, table_name, field_name, old_value, new_value, changed_by, changed_at, change_type)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    ['ROLE', 'Z_FI_AP_APPROVER', 'AGR_USERS', 'UNAME', null, 'JDOE', 'MSMITH', '2026-08-20T09:10:00Z', 'INSERT'],
    ['SYSTEM', 'CLIENT_100', 'T000', 'CCCATEGORY', 'T', 'P', 'MSMITH', '2026-08-22T16:31:00Z', 'UPDATE'],
    ['FI_DOC', '5000000002', 'BKPF', 'BSTAT', null, 'R', 'JDOE', '2026-08-13T10:00:00Z', 'UPDATE'],
    ['USER', 'PBROWN', 'USR02', 'UFLAG', '0', '128', 'MSMITH', '2026-07-30T11:00:00Z', 'UPDATE'],
  ]
);

seedIfEmpty(
  'object_parameters',
  `INSERT INTO object_parameters (object_name, parameter_type, parameter_id, parameter_value)
   VALUES (?, ?, ?, ?)`,
  [
    // SAP* — representative spread across all 3 parameter types. "Roles Assigned"
    // is deliberately non-compliant (a real baseline control expects "None" here)
    // so a demo Control run against this system produces a genuine deviation.
    ['SAP*', 'GENERAL', 'Password Changed', 'Yes'],
    ['SAP*', 'GENERAL', 'Super User', 'SUPER'],
    ['SAP*', 'GENERAL', 'User Type', 'B (System User)'],
    ['SAP*', 'GENERAL', 'Locked', 'Yes'],
    ['SAP*', 'GENERAL', 'Roles Assigned', 'Z_CUSTOM_ROLE'],
    ['SAP*', 'GENERAL', 'Security Policy', 'Z_NOEXPIRY'],
    ['SAP*', 'GENERAL', 'Failed Logins', '3'],
    ['SAP*', 'SETGET', 'BUK', '1000'],
    ['SAP*', 'DEFAULT', 'Decimal Notation', 'X'],

    // DDIC — password not changed from default, a classic real finding.
    ['DDIC', 'GENERAL', 'Password Changed', 'No'],
    ['DDIC', 'GENERAL', 'User Type', 'B (System User)'],

    // SAPCPIC — should be locked when unused; seeded unlocked on purpose.
    ['SAPCPIC', 'GENERAL', 'Locked', 'No'],

    ['TMSADM', 'GENERAL', 'Password Changed', 'Yes'],
    ['WF-BATCH', 'GENERAL', 'User Type', 'B (System User)'],
    ['SAP_WFRT', 'GENERAL', 'Roles Assigned', 'None'],
    ['EARLYWATCH', 'GENERAL', 'Locked', 'Yes'],
    ['SDMI_*', 'GENERAL', 'SDMI_* Exists', 'No'],
    ['J2EE_ADMIN', 'GENERAL', 'Password Changed', 'Yes'],
    ['J2EE_GUEST', 'GENERAL', 'Locked', 'Yes'],
    ['SAPJSF', 'GENERAL', 'Security Policy', 'Z_NOEXPIRY'],
    ['ADSUSER', 'GENERAL', 'Password Changed', 'Yes'],
  ]
);

// OData-ish entity set name -> backing table. Route regexes only ever match one
// of these literal keys, so `table` values here never come from request input.
const ENTITY_SETS = {
  Users: 'users',
  CriticalTransactionLogs: 'critical_transaction_logs',
  GLDocuments: 'gl_documents',
  ChangeLogs: 'change_logs',
  ObjectParameters: 'object_parameters',
};

// object_parameters is the one entity set that needs exact-match narrowing
// (control_engine looks up one specific object/type/parameter at a time) —
// xyra-s4 otherwise has no $filter support at all. `filters` keys are always
// from the hardcoded literal list below, never request input, so this stays
// injection-safe the same way `table` already is.
const FILTERABLE_COLUMNS = ['object_name', 'parameter_type', 'parameter_id'];

function listEntities(table, top, skip, filters) {
  const cols = filters ? FILTERABLE_COLUMNS.filter((c) => filters[c]) : [];
  const where = cols.length ? `WHERE ${cols.map((c) => `${c} = ?`).join(' AND ')}` : '';
  const params = cols.map((c) => filters[c]);

  const rows = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, top, skip);
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table} ${where}`).get(...params);
  return { rows, total: count };
}

function getEntity(table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null;
}

module.exports = { ENTITY_SETS, listEntities, getEntity };
