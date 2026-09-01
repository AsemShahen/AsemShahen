'use strict';
// أدوات قواعد البيانات: النسخ الاحتياطي والاستعادة والضغط والإصلاح
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const SQLITE_HEADER = 'SQLite format 3';

function companyDbPath(companyId) {
  return path.join(DATA_DIR, `company_${companyId}.db`);
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

// إفراغ ملف WAL إلى قاعدة البيانات الرئيسية قبل أي عملية نسخ أو استبدال
function checkpointFile(file) {
  if (!fs.existsSync(file)) return;
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

function fileStat(file) {
  const st = fs.statSync(file);
  return { size: st.size, mtime: st.mtime };
}

function isValidSqlite(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return read === 16 && buf.toString('utf8', 0, 15) === SQLITE_HEADER;
  } catch (e) {
    return false;
  }
}

// ---------- النسخ الاحتياطي ----------
function listBackups(companyId) {
  const prefix = `company_${companyId}_`;
  const all = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.db'));
  return all.map(f => {
    const st = fileStat(path.join(BACKUP_DIR, f));
    return { filename: f, size: st.size, mtime: st.mtime };
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

function createBackup(companyId) {
  const src = companyDbPath(companyId);
  if (!fs.existsSync(src)) throw new Error('قاعدة بيانات الشركة غير موجودة');
  checkpointFile(src);
  const dest = path.join(BACKUP_DIR, `company_${companyId}_${stamp()}.db`);
  fs.copyFileSync(src, dest);
  const st = fileStat(dest);
  return { filename: path.basename(dest), size: st.size, mtime: st.mtime };
}

function resolveBackup(companyId, filename) {
  const name = String(filename || '').trim();
  if (!/^company_\d+_[^/]+\.db$/.test(name)) throw new Error('اسم النسخة الاحتياطية غير صالح');
  const file = path.join(BACKUP_DIR, name);
  if (!file.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(file)) throw new Error('النسخة الاحتياطية غير موجودة');
  if (!name.startsWith(`company_${companyId}_`)) throw new Error('النسخة الاحتياطية لا تخص هذه الشركة');
  return file;
}

// ---------- الاستعادة ----------
function restoreFrom(companyId, backupFile) {
  if (!isValidSqlite(backupFile)) throw new Error('الملف ليس قاعدة بيانات SQLite صالحة');
  const dest = companyDbPath(companyId);
  // نسخة أمان تلقائية قبل الاستعادة
  createBackup(companyId);
  checkpointFile(dest);
  fs.copyFileSync(backupFile, dest);
  for (const s of ['-wal', '-shm']) {
    const f = dest + s;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // فتح القاعدة المهاجرة للتأكد من سلامتها وتطبيق أي ترقيات للمخطط
  const openCompanyDb = require('./company-db').openCompanyDb;
  const db = openCompanyDb(companyId);
  const ok = db.pragma('integrity_check', { simple: true }) === 'ok';
  db.close();
  if (!ok) throw new Error('تعذر فتح قاعدة البيانات المستعادة بشكل سليم');
  return { ok: true };
}

function restoreFromBackup(companyId, filename) {
  const file = resolveBackup(companyId, filename);
  return restoreFrom(companyId, file);
}

function restoreFromUpload(companyId, tmpFile) {
  return restoreFrom(companyId, tmpFile);
}

// ---------- الضغط ----------
function compress(companyId) {
  const file = companyDbPath(companyId);
  if (!fs.existsSync(file)) throw new Error('قاعدة بيانات الشركة غير موجودة');
  const before = fs.statSync(file).size;
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const after = fs.statSync(file).size;
  return { before, after, saved: before - after };
}

// ---------- الإصلاح ----------
function repair(companyId) {
  const file = companyDbPath(companyId);
  if (!fs.existsSync(file)) throw new Error('قاعدة بيانات الشركة غير موجودة');
  const db = new Database(file);
  const integrity = db.pragma('integrity_check', { simple: true });
  const fk = db.pragma('foreign_key_check');
  let vacuumError = null;
  try {
    db.exec('VACUUM');
  } catch (e) {
    vacuumError = e.message;
  }
  db.close();
  const integrityOk = integrity === 'ok';
  return {
    integrity: integrityOk ? 'ok' : String(integrity).slice(0, 200),
    fk_violations: fk.length,
    vacuum_done: !vacuumError,
    vacuum_error: vacuumError
  };
}

// ---------- معلومات قاعدة البيانات ----------
function info(companyId) {
  const file = companyDbPath(companyId);
  const backupInfo = listBackups(companyId);
  if (!fs.existsSync(file)) return { exists: false, backups: backupInfo };
  const st = fs.statSync(file);
  return {
    exists: true,
    size: st.size,
    mtime: st.mtime,
    backups: backupInfo
  };
}

module.exports = {
  BACKUP_DIR, createBackup, listBackups, resolveBackup, restoreFromBackup, restoreFromUpload,
  compress, repair, info
};
