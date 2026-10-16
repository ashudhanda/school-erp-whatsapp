import { DatabaseSync } from 'node:sqlite';
export function localClient(path) {
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  let tail = Promise.resolve();
  const executeSync = (input) => {
    const { sql, args = [] } = typeof input === 'string' ? { sql: input } : input;
    const st = connection.prepare(sql);
    if (st.columns().length) return { rows: st.all(...args), rowsAffected: 0 };
    const v = st.run(...args);
    return { rows: [], rowsAffected: Number(v.changes), lastInsertRowid: v.lastInsertRowid };
  };
  const lock = (fn) => { const task = tail.then(fn); tail = task.catch(() => {}); return task; };
  return {
    execute: (input) => lock(() => executeSync(input)),
    batch: (inputs) => lock(() => {
      connection.exec('BEGIN IMMEDIATE');
      try { const result = inputs.map(executeSync); connection.exec('COMMIT'); return result; }
      catch (e) { connection.exec('ROLLBACK'); throw e; }
    }),
    transaction: async () => {
      let release; const next = new Promise(resolve => { release = resolve; });
      const before = tail; tail = next; await before; connection.exec('BEGIN IMMEDIATE');
      let closed = false;
      return { execute: async (q) => executeSync(q), batch: async (q) => q.map(executeSync),
        commit: async () => { if (!closed) { connection.exec('COMMIT'); closed=true; release(); } },
        rollback: async () => { if (!closed) { connection.exec('ROLLBACK'); closed=true; release(); } },
        close: () => { if (!closed) { connection.exec('ROLLBACK'); closed=true; release(); } }
      };
    },
    close: () => connection.close()
  };
}
