import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  /** @brief 保存可直接返回给客户端的错误与 HTTP 状态。 */
  constructor(public status: number, message: string) { super(message); }
}

/** @brief 打开本地数据库并建立模型、任务、调用和访问凭据表。 */
export function Store_open(directory: string) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'atelier.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, secret TEXT NOT NULL,
      created_at TEXT NOT NULL, synced_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id), remote_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, available INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL DEFAULT '',
      UNIQUE(provider_id, remote_id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model_id TEXT NOT NULL REFERENCES models(id),
      status TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), number INTEGER NOT NULL,
      prompt TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL, output TEXT NOT NULL DEFAULT '',
      error TEXT, finish_reason TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(task_id, number)
    );
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, task_id TEXT, turn_id TEXT, model_id TEXT NOT NULL,
      model_name TEXT NOT NULL, provider_name TEXT NOT NULL, source TEXT NOT NULL,
      status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      duration_ms INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS turns_queue ON turns(status, created_at);
    CREATE INDEX IF NOT EXISTS calls_date ON calls(created_at);
  `);
  const keyPath = join(directory, 'secret.key');
  // 独立密钥使数据库副本中的供应商凭据保持加密状态。
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('本地加密密钥格式无效');
  return { db, key };
}

export type Store = ReturnType<typeof Store_open>;

/** @brief 使用 AES-GCM 加密供应商密钥，同时保存完整性校验标签。 */
export function Secret_encrypt(key: Buffer, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

/** @brief 还原通过完整性校验的供应商密钥。 */
export function Secret_decrypt(key: Buffer, value: string) {
  const buffer = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
  cipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString('utf8');
}

/** @brief 为随机访问令牌生成不可逆索引。 */
export function Secret_hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** @brief 为管理口令添加随机盐并派生存储哈希。 */
export function Password_hash(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}

/** @brief 以恒定时间比较验证管理口令。 */
export function Password_verify(value: string, stored: string) {
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(value, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
