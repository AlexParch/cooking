// SQLite (node:sqlite) с тем же интерфейсом, что у Cloudflare D1: prepare/bind/first/all/run/batch.

const clean = (params) => params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));

/** @param {import("node:sqlite").DatabaseSync} sqlite */
export function createD1(sqlite) {
  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params);
    }
    _rows() {
      return sqlite.prepare(this.sql).all(...clean(this.params)).map((r) => ({ ...r }));
    }
    async all() {
      return { results: this._rows(), success: true, meta: {} };
    }
    async first(column) {
      const row = this._rows()[0] ?? null;
      if (!row) return null;
      return column ? (row[column] ?? null) : row;
    }
    _run() {
      if (/\breturning\b/i.test(this.sql)) {
        const results = this._rows();
        return { results, success: true, meta: { changes: results.length } };
      }
      const r = sqlite.prepare(this.sql).run(...clean(this.params));
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    async run() {
      return this._run();
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    /** Как в D1: все запросы — одной транзакцией. */
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const out = statements.map((s) => s._run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1 };
    },
  };
}
