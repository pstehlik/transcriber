const initSqlJs = require('sql.js');
const fs = require('fs');

let db = null;
let currentDbPath = null;

async function getDb(dbPath) {
  if (db) return db;
  const SQL = await initSqlJs();
  currentDbPath = dbPath;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      duration TEXT,
      format TEXT,
      text TEXT DEFAULT '',
      status TEXT DEFAULT 'running',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      completed_at TEXT
    )
  `);
  save();
  return db;
}

function save() {
  if (db && currentDbPath) {
    const data = db.export();
    fs.writeFileSync(currentDbPath, Buffer.from(data));
  }
}

async function insertTranscription(dbPath, { filePath, fileName, fileSize, duration, format }) {
  const d = await getDb(dbPath);
  d.run(
    `INSERT INTO transcriptions (file_path, file_name, file_size, duration, format)
     VALUES (?, ?, ?, ?, ?)`,
    [filePath, fileName, fileSize || null, duration || null, format || null]
  );
  const result = d.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  save();
  return id;
}

async function appendText(dbPath, id, newText) {
  const d = await getDb(dbPath);
  d.run(`UPDATE transcriptions SET text = text || ? WHERE id = ?`, [newText, id]);
  save();
}

async function completeTranscription(dbPath, id, status = 'completed') {
  const d = await getDb(dbPath);
  d.run(
    `UPDATE transcriptions SET status = ?, completed_at = datetime('now', 'localtime') WHERE id = ?`,
    [status, id]
  );
  save();
}

async function getTranscription(dbPath, id) {
  const d = await getDb(dbPath);
  const result = d.exec('SELECT * FROM transcriptions WHERE id = ?', [id]);
  if (!result.length || !result[0].values.length) return null;
  return rowToObject(result[0]);
}

async function getAllTranscriptions(dbPath) {
  const d = await getDb(dbPath);
  const result = d.exec('SELECT * FROM transcriptions ORDER BY id DESC');
  if (!result.length) return [];
  return result[0].values.map((row) => zipRow(result[0].columns, row));
}

function rowToObject(result) {
  const cols = result.columns;
  const vals = result.values[0];
  return zipRow(cols, vals);
}

function zipRow(cols, vals) {
  const obj = {};
  for (let i = 0; i < cols.length; i++) {
    obj[cols[i]] = vals[i];
  }
  return obj;
}

async function deleteTranscription(dbPath, id) {
  const d = await getDb(dbPath);
  d.run('DELETE FROM transcriptions WHERE id = ?', [id]);
  save();
}

async function deleteAllTranscriptions(dbPath) {
  const d = await getDb(dbPath);
  d.run('DELETE FROM transcriptions');
  save();
}

async function hasTranscriptionForPath(dbPath, filePath) {
  const d = await getDb(dbPath);
  const result = d.exec('SELECT COUNT(*) FROM transcriptions WHERE file_path = ?', [filePath]);
  return result.length > 0 && result[0].values[0][0] > 0;
}

function close() {
  if (db) {
    save();
    db.close();
    db = null;
    currentDbPath = null;
  }
}

module.exports = {
  getDb,
  insertTranscription,
  appendText,
  completeTranscription,
  getTranscription,
  getAllTranscriptions,
  hasTranscriptionForPath,
  deleteTranscription,
  deleteAllTranscriptions,
  close,
};
