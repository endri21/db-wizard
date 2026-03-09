const sql = require("mssql");

function buildMsSqlClientConfig(cfg) {
  if (cfg.connectionString) return cfg.connectionString;
  return {
    server: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: { encrypt: false, trustServerCertificate: true },
  };
}

async function withMsSqlPool(cfg, runner) {
  const pool = await sql.connect(buildMsSqlClientConfig(cfg));
  try {
    return await runner(pool);
  } finally {
    await pool.close();
  }
}

async function listTables(cfg, formatSchemaTree) {
  return withMsSqlPool(cfg, async (pool) => {
    const tableResult = await pool.request().query(`
      SELECT TABLE_SCHEMA AS schema, TABLE_NAME AS name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    const procedureResult = await pool.request().query(`
      SELECT ROUTINE_SCHEMA AS schema, ROUTINE_NAME AS name
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE='PROCEDURE'
      ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
    `);
    return formatSchemaTree(tableResult.recordset, procedureResult.recordset);
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

  return withMsSqlPool(cfg, async (pool) => {
    const result = await pool.request().query(`
      SELECT fk.name AS constraint_name,
             sch1.name AS from_schema,
             t1.name AS from_table,
             c1.name AS from_column,
             sch2.name AS to_schema,
             t2.name AS to_table,
             c2.name AS to_column
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      JOIN sys.tables t1 ON fkc.parent_object_id = t1.object_id
      JOIN sys.schemas sch1 ON t1.schema_id = sch1.schema_id
      JOIN sys.columns c1 ON c1.object_id = t1.object_id AND c1.column_id = fkc.parent_column_id
      JOIN sys.tables t2 ON fkc.referenced_object_id = t2.object_id
      JOIN sys.schemas sch2 ON t2.schema_id = sch2.schema_id
      JOIN sys.columns c2 ON c2.object_id = t2.object_id AND c2.column_id = fkc.referenced_column_id
      ORDER BY from_schema, from_table, constraint_name
    `);
    return result.recordset.filter(includeRel);
  });
}

async function listTableColumns(cfg, tables = []) {
  const selected = new Set((tables || []).map((t) => String(t).toLowerCase()));

  return withMsSqlPool(cfg, async (pool) => {
    const result = await pool.request().query(`
      SELECT s.name AS schema,
             t.name AS table_name,
             c.name AS column_name,
             ty.name AS data_type,
             CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
             CASE WHEN i.is_primary_key = 1 THEN 1 ELSE 0 END AS is_primary
      FROM sys.tables t
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      LEFT JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.column_id = c.column_id
      LEFT JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
      ORDER BY s.name, t.name, c.column_id
    `);
    return result.recordset.filter((r) => !selected.size || selected.has(`${r.schema}.${r.table_name}`.toLowerCase()));
  });
}

async function runQuery(cfg, query) {
  return withMsSqlPool(cfg, async (pool) => {
    const result = await pool.request().query(query);
    return {
      columns: result.recordset.length ? Object.keys(result.recordset[0]) : [],
      rows: result.recordset.slice(0, 200),
    };
  });
}

module.exports = {
  listTables,
  listRelationships,
  listTableColumns,
  runQuery,
};
