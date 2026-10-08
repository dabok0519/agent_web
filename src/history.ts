/**
 * 대화 이력 저장소. 응답이 끝날 때 server.ts 가 saveChat 으로 대화 전체(UIMessage[])를 넣는다.
 * 뼈대 4-a (2026-10-08): 저장. 4-b 문 1: chats 테이블 + 목록. 문 2: 세션 하나 불러오기.
 * src/web 전용 (src/mcp/agent/history.ts 의 prepare / 트랜잭션 패턴을 참고해 새로 씀).
 */

/**
 * node 내장 SQLite. 파일 하나가 DB 다. 새 의존성 없음 (node 22.13+).
 * Sync 판이라 await 가 없다. 이력은 작아서 기다려도 된다.
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * UIMessage: 브라우저(useChat)가 보는 메시지 모양. onEnd 가 주는 배열의 원소 타입. 그대로 저장하니 변환 없음.
 */
import type { UIMessage } from 'ai';

/**
 * DB 를 열고 저장 함수를 돌려준다. 테이블이 없으면 만든다.
 * server.ts 가 시작할 때 부른다.
 */
/**
 * 세션 목록 한 줄 모양. 사이드바가 쓰는 세 칸.
 */
export type ChatRow = { id: string; title: string; updatedAt: string };

/** TODO: 제목으로 자를 글자 수 */
const TITLE_LEN = 30;

/**
 * 대화에서 제목을 뽑는다. 지금은 첫 user 메시지의 text 앞글자.
 * 나중에 LLM 으로 제목을 짓게 바꾸려면 이 함수만 async 로 바꾸고 saveChat 에서 await 하면 된다. 다른 데는 안 건드린다.
 * parts 에 text 가 없으면(파일만 보낸 경우 등) 빈 글자.
 */
function makeTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = first?.parts.find((p) => p.type === 'text');
  return text && 'text' in text ? text.text.slice(0, TITLE_LEN) : '';
}

export function openHistory(path: string) {
  const db = new DatabaseSync(path);

  /**
   * CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 두 개 안 생긴다.
   * chats = 대화당 1줄(목록용-제목). chat_messages = 메시지당 1줄.
   * chat_id = 브라우저(useChat)가 정한 대화 id. seq = 배열 순서. body = UIMessage 하나를 JSON 글자로 통째.
   * 칸으로 안 푸는 이유: parts 안에 text·도구 호출·결과가 섞여 있어 모양이 메시지마다 다르다. 통째로 넣고 통째로 꺼낸다.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (chat_id, seq)
    );
  `);

  /**
   * SQL 을 미리 컴파일해 둔다. ? 자리에 값을 바인딩한다. ABAP 의 호스트 변수 @lv 와 같다.
   * 값을 글자에 이어 붙이면 안 된다. 따옴표 하나로 SQL 이 깨진다.
   * INSERT OR REPLACE = 같은 id 가 있으면 그 줄을 통째로 바꾼다. MODIFY 와 같다.
   */
  const upsertChat = db.prepare(`INSERT OR REPLACE INTO chats (id, title, updated_at) VALUES (?, ?, ?)`);
  const selectChats = db.prepare(`SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC LIMIT ?`);
  const deleteChat = db.prepare(`DELETE FROM chat_messages WHERE chat_id = ?`);
  const insertMessage = db.prepare(`INSERT INTO chat_messages (chat_id, seq, body) VALUES (?, ?, ?)`);
  const selectMessages = db.prepare(`SELECT body FROM chat_messages WHERE chat_id = ? ORDER BY seq`);

  return {
    /**
     * 최근 대화부터 limit 개. server.ts 의 GET /api/chats 가 돌려준다.
     * all() 결과는 칸 타입이 없어 하나씩 본다. 우리가 넣은 값이라 틀리면 코드 버그.
     */
    listChats(limit: number): ChatRow[] {
      const rows: ChatRow[] = [];
      for (const r of selectChats.all(limit)) {
        if (typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.updated_at !== 'string') {
          throw new Error(`chats 줄 모양이 다르다 ${JSON.stringify(r)}`);
        }
        rows.push({ id: r.id, title: r.title, updatedAt: r.updated_at });
      }
      return rows;
    },

    /**
     * 세션 하나의 메시지 전체를 seq 순으로. 저장의 역순: body 글자 → JSON.parse → UIMessage.
     * server.ts 의 GET /api/chats/:id 가 돌려주고, 뼈대 5 가 useChat({ id, messages }) 에 그대로 꽂는다.
     * 없는 id 면 빈 배열. JSON.parse 결과는 타입이 없어 객체인지 본다. 우리가 stringify 로 넣은 거라 틀리면 코드 버그.
     */
    loadChat(chatId: string): UIMessage[] {
      const messages: UIMessage[] = [];
      for (const r of selectMessages.all(chatId)) {
        if (typeof r.body !== 'string') throw new Error(`chat_messages.body 가 글자가 아니다 ${JSON.stringify(r)}`);
        const parsed: unknown = JSON.parse(r.body);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error(`chat_messages.body 가 객체가 아니다 ${r.body}`);
        }
        messages.push(parsed as UIMessage);
      }
      return messages;
    },

    /**
     * 대화 하나를 통째로 저장한다. onEnd 가 매번 "원본 + 새 답" 전체를 주므로, 그 id 의 줄을 전부 지우고 다시 넣는다.
     * 트랜잭션. 중간에 실패하면 전부 취소돼 반쪽 이력이 안 남는다. COMMIT WORK / ROLLBACK WORK.
     * ponytail: 통째 교체. 대화가 수백 줄로 길어지면 seq 이어쓰기로 바꾼다.
     */
    saveChat(chatId: string, messages: UIMessage[]): void {
      db.exec('BEGIN');
      try {
        /** 목록용 1줄. 제목은 매번 다시 뽑는다(첫 질문은 안 바뀌니 결과도 같다). 시각은 지금 */
        upsertChat.run(chatId, makeTitle(messages), new Date().toISOString());
        deleteChat.run(chatId);
        /**
         * LOOP AT messages. 인덱스가 곧 seq. JSON.stringify = 객체 → 글자.
         */
        messages.forEach((m, i) => insertMessage.run(chatId, i + 1, JSON.stringify(m)));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    close(): void {
      db.close();
    },
  };
}
