const mysql = require("mysql2/promise");

async function withMySqlConnection(cfg, runner) {
  const connection = cfg.connectionString
    ? await mysql.createConnection(cfg.connectionString)
    : await mysql.createConnection(cfg);
  try {
    return await runner(connection);
  } finally {
    await connection.end();
  }
}

async function listTables(cfg, formatSchemaTree) {
  return withMySqlConnection(cfg, async (connection) => {
    const [tableRows] = await connection.query(`
      SELECT TABLE_SCHEMA AS schema, TABLE_NAME AS name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    const [procedureRows] = await connection.query(`
      SELECT ROUTINE_SCHEMA AS schema, ROUTINE_NAME AS name
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'PROCEDURE'
        AND ROUTINE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
    `);
    return formatSchemaTree(tableRows, procedureRows);
  });
}

async function listRelationships(cfg, selectedTables = []) {
  const selectedSet = new Set((selectedTables || []).map((t) => String(t).toLowerCase()));
  const includeRel = (row) => {
    if (!selectedSet.size) return true;
    const from = `${row.from_schema}.${row.from_table}`.toLowerCase();
    const to = `${row.to_schema}.${row.to_table}`.toLowerCase();
    return selectedSet.has(from) || selectedSet.has(to);
  };

  return withMySqlConnection(cfg, async (connection) => {
    const [rows] = await connection.query(`
      SELECT kcu.CONSTRAINT_NAME AS constraint_name,
             kcu.TABLE_SCHEMA AS from_schema,
             kcu.TABLE_NAME AS from_table,
             kcu.COLUMN_NAME AS from_column,
             kcu.REFERENCED_TABLE_SCHEMA AS to_schema,
             kcu.REFERENCED_TABLE_NAME AS to_table,
             kcu.REFERENCED_COLUMN_NAME AS to_column
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY from_schema, from_table, constraint_name
    `);
    return rows.filter(includeRel);
  });
}

async function listTableColumns(cfg, tables = []) {
  const selected = new Set((tables || []).map((t) => String(t).toLowerCase()));

  return withMySqlConnection(cfg, async (connection) => {
    const [rows] = await connection.query(`
      SELECT c.TABLE_SCHEMA AS schema,
             c.TABLE_NAME AS table_name,
             c.COLUMN_NAME AS column_name,
             c.DATA_TYPE AS data_type,
             c.IS_NULLABLE AS is_nullable,
             CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS is_primary
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
        ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
       AND c.TABLE_NAME = k.TABLE_NAME
       AND c.COLUMN_NAME = k.COLUMN_NAME
       AND k.CONSTRAINT_NAME = 'PRIMARY'
      WHERE c.TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
    `);
    return rows.filter((r) => !selected.size || selected.has(`${r.schema}.${r.table_name}`.toLowerCase()));
  });
}

async function runQuery(cfg, query) {
  return withMySqlConnection(cfg, async (connection) => {
    const [rows, fields] = await connection.query(query);
    return {
      columns: fields ? fields.map((f) => f.name) : [],
      rows: Array.isArray(rows) ? rows.slice(0, 200) : [],
    };
  });
}

module.exports = {
  listTables,
  listRelationships,
  listTableColumns,
  runQuery,
};
