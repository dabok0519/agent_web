/**
 * DB 안을 들여다본다. 서버가 저장한 대화를 chat_id 별로 몇 줄인지, 각 줄의 role 과 parts 종류를 찍는다.
 *   npx tsx src/history-check.ts
 */
import { DatabaseSync } from 'node:sqlite';

/** TODO: server.ts 의 DB 파일 경로와 같은 값 */
const DB_PATH = 'agent-history.db';

const db = new DatabaseSync(DB_PATH, { readOnly: true });

for (const row of db.prepare(`SELECT chat_id, seq, body FROM chat_messages ORDER BY chat_id, seq`).all()) {
  /** all() 결과는 칸 타입이 없어 글자인지 본다 */
  if (typeof row.body !== 'string') continue;
  const m = JSON.parse(row.body) as { role: string; parts: { type: string }[] };
  console.log(`${String(row.chat_id)} #${String(row.seq)} ${m.role.padEnd(9)} ${m.parts.map((p) => p.type).join(', ')}`);
}

db.close();
