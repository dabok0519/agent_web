/**
 * 웹 입구. useChat 이 보낸 대화를 받아 runAgent 를 돌리고 조각을 그대로 응답으로 흘린다.
 * 서버는 대화를 기억하지 않는다. 브라우저가 매 요청 전체 이력을 보낸다(useChat 기본 동작). 저장은 뼈대 4.
 * Hono 판 (2026-10-07). 전 판은 node:http 로 길 분기·본문 읽기·JSON 응답을 손으로 썼다. 그 코드를 주석에 남겨 비교한다.
 *   npm run server
 */

/**
 * Hono: 웹 표준 Request/Response 로 일하는 작은 서버 틀. 길 등록(app.post)·본문 파싱(c.req.json)·응답(c.json) 을 대신한다.
 * 프레임워크 없이는: import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
 * 문서: https://hono.dev/docs/
 */
import { Hono } from 'hono';

/**
 * node 위에서 Hono 를 띄우는 어댑터. node 의 req/res 를 표준 Request/Response 로 바꿔 app.fetch 에 넘기고, 돌려받은 Response 를 res 에 쓴다.
 * 문서: https://hono.dev/docs/getting-started/nodejs
 */
import { serve } from '@hono/node-server';

/**
 * safeValidateUIMessages: 외부 입력 가드. 
 * convertToModelMessages: 화면용 → 모델용 변환. 
 * toUIMessageStream: 조각 변환. (브라우저에 다시 보내기 위함 )
 * createUIMessageStreamResponse: 조각 스트림을 표준 Response 로. (전 판의 pipeUIMessageStreamToResponse 자리)
 */
import { safeValidateUIMessages, convertToModelMessages, toUIMessageStream, createUIMessageStreamResponse, generateId } from 'ai';

import { runAgent } from './agent.js';
import { openHistory } from './history.js';

/** TODO: 포트 번호. 브라우저·curl 이 붙을 주소 */
const PORT = 9000;

/** TODO: 채팅 경로 글자. 뼈대 5 의 useChat api 옵션과 같아야 한다
 * http://127.0.0.1:9000/api/chat
 * └──────┬──────┘└─┬─┘└───┬───┘
 *    호스트        PORT   CHAT_PATH
 */
const CHAT_PATH = '/api/chat';

/** TODO: 모델·도구 오류가 났을 때 화면에 보여 줄 문구. 서버 내부 메시지·키가 브라우저로 새면 안 된다 */
const ERROR_TEXT = '모델 및 도구 사용에 실패하였습니다 다시 시도해주세용 ~~';

/** TODO: DB 파일 경로. .gitignore 의 *.db 에 걸리는 이름으로. 실행 위치 기준이라 저장소 루트에서 돌린다 */
const DB_PATH = 'agent-history.db';

/**
 * 이력 DB. 파일이 없으면 만든다. 프로그램 시작 때 한 번 열고 SIGINT 에서 닫는다.
 */
const history = openHistory(DB_PATH);

/**
 * ① 앱 하나. 길(route)을 여기 등록하고, 요청이 오면 맞는 핸들러를 찾아 부른다.
 * ② 프레임워크 없이는: createServer((req, res) => handle(req, res)) 에서 handle 안의 if 로 길을 가렸다.
 * ③ https://hono.dev/docs/api/hono
 */
const app = new Hono();

/**
 * 전 판에 있었고 지금은 없어진 함수 둘. Hono 가 대신한다.
 *
 *   async function readBody(req: IncomingMessage): Promise<string> {   → c.req.json()
 *     let text = '';
 *     for await (const chunk of req) text += chunk;
 *     return text;
 *   }
 *
 *   function sendJson(res: ServerResponse, status: number, body: unknown): void {   → c.json(body, status)
 *     res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
 *     res.end(JSON.stringify(body));
 *   }
 */

/**
 * ① 길 등록. POST /api/chat 만 이 핸들러로. 안 맞는 길(GET, 다른 경로)은 Hono 가 알아서 404.
 * ② 프레임워크 없이는:
 *      if (req.method !== 'POST' || req.url !== CHAT_PATH) { sendJson(res, 404, { error: '없는 길' }); return; }
 *    길이 늘 때마다 if 가 늘었다. Hono 는 app.get/post 한 줄씩.
 * ③ https://hono.dev/docs/api/routing
 *
 * c = Context. 전 판의 (req, res) 한 쌍이 객체 하나로 합쳐진 것. c.req 가 요청, 응답은 return 으로 돌려준다.
 * 흐름: 본문 파싱 → 가드 → 변환 → runAgent → 조각 변환 → Response 로.
 */
app.post(CHAT_PATH, async (c) => {
  /**
   * 학습용 로그. 전 판의 console.log('[req]', req.method, req.url, req.headers) 자리. 확인했으면 지운다.
   * c.req.path 는 경로만, c.req.header() 는 헤더 전부.
   */
  console.log('[req]', c.req.method, c.req.path, c.req.header());

  /**
   * ① 본문을 모아 JSON 으로 푼다. 깨진 JSON 은 throw 하니 TRY 로 감싼다. 결과는 타입이 없어 아래 가드가 본다.
   * ② 프레임워크 없이는: body = JSON.parse(await readBody(req)) — 조각을 for await 로 모으는 readBody 를 손으로 썼다.
   */
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    /**
     * ① JSON 응답을 돌려준다. 상태코드·헤더·본문 직렬화를 Hono 가 한다. return 으로 끝내야 밑으로 안 내려간다.
     * ② 프레임워크 없이는: sendJson(res, 400, {...}); return; — writeHead + end 를 res 에 직접 썼다.
     */
    return c.json({ error: 'JSON 이 아니다' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return c.json({ error: '본문이 객체가 아니다' }, 400);
  }
  /** 외부 JSON 은 키만 글자로 확실하고 값은 뭔지 모른다. unknown 으로 받아 아래 가드를 강제한다 */
  const o = body as Record<string, unknown>;

  /** TODO: regenerate-message(답 다시 만들기)는 범위 밖. 막을지 허용할지 */
  if (o.trigger !== 'submit-message') {
    return c.json({ error: 'trigger 는 submit-message 만 받는다' }, 400);
  }

  /**
   * 대화 id 가드. useChat 이 정해서 보낸다. 저장 키라 없으면 받지 않는다.
   */
  if (typeof o.id !== 'string' || !o.id.trim()) {
    return c.json({ error: 'id 가 없다' }, 400);
  }
  const chatId = o.id;

  /**
   * ① 브라우저가 보낸 messages 배열이 UIMessage 모양(id·role·parts)인지 검사한다.
   *    (tools 옵션을 주면 도구 part 의 input/output 까지 보는데 타입 맞추기가 번거로워 뺐다)
   * ② 안 쓰면: 엉뚱한 모양이 convertToModelMessages 까지 가서 거기서 터진다. 외부 입력이라 가드는 생략 불가.
   *    validateUIMessages 는 같은 일을 하되 실패 시 throw. 여기선 400 으로 답해야 하니 safe 판.
   */
  const validated = await safeValidateUIMessages({ messages: o.messages });
  if (!validated.success) {
    return c.json({ error: `messages 모양이 다르다: ${validated.error.message}` }, 400);
  }

  /**
   * ① 화면용 UIMessage(parts 배열) → 모델용 ModelMessage(role + content). 앞 턴의 도구 part 는 tool-call / tool-result 로 바뀌어
   *    모델이 "앞서 이걸 조회했다" 를 안다.
   * ② 안 쓰면: streamText 가 messages 모양이 다르다고 거절한다. async 라 await 필수.
   * ③ https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages
   */
  const modelMessages = await convertToModelMessages(validated.data);

  const result = runAgent(modelMessages);

  /**
   * ① 조각 스트림을 표준 Response 로 만든다. 헤더(text/event-stream)와 `data: {...}\n\n` 줄 변환을 SDK 가 한다.
   */
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,

      /**
       * ① 이 요청의 원본 이력을 SDK 에 알린다. 그래야 onEnd 가 "원본 + 새 답" 을 합쳐 주고, 새 답 메시지의 id 도 SDK 가 만들어 start 조각에 실어 보낸다.
       * ② 안 넘기면: onEnd 의 messages 에 새 assistant 하나만 온다. 앞부분은 우리가 validated.data 에서 직접 이어 붙여야 하고 id 가 브라우저와 어긋날 수 있다.
       */
      originalMessages: validated.data,

      /**
       * 새 assistant 메시지의 id 를 만든다. 안 넘기면 SDK 가 id 를 안 만들어 '' 로 저장된다(DB 에서 확인).
       * '' 가 두 개 이상이면 React key 가 겹치고, 다음 턴에 이력을 보낼 때 id 가 비어 간다.
       */
      generateMessageId: generateId,

      /**
       * ① 스트림이 끝나면 한 번. 조각을 브라우저로 보내면서 서버 안에서도 같은 뭉치기 함수(processUIMessageStream)를 돌려 두었다가,
       *    finish 뒤에 [...originalMessages, 새 assistant] 전체를 준다. 그대로 저장한다. 변환 없음.
       * ② 안 넘기면: 서버는 뭉치기를 안 하고 조각을 통과만 시킨다(지금까지 상태). 저장할 타이밍도 없다. onFinish 는 deprecated 별칭
       */
      onEnd: ({ messages }) => {
        history.saveChat(chatId, messages);
        console.log(`[save] ${chatId} ${messages.length}개`);
      },

      /**
       * TODO: onError — 루프 안에서 throw 가 나면(모델 401·429·도구 밖 에러) 이 함수가 돌려준 글자가 error 조각으로 브라우저에 간다.
       * 기본값은 "An error occurred." 원인은 서버 터미널에만 찍고 화면엔 고정 문구만.
       */
      onError: (e) => {
        console.error('[web]', e instanceof Error ? e.message : String(e));
        return ERROR_TEXT;
      },
    }),
  });
});

/** TODO: 목록 경로 글자. 뼈대 5 사이드바가 부른다 */
const CHATS_PATH = '/api/chats';

/** TODO: 목록에 돌려줄 개수 */
const CHATS_LIMIT = 5;

/**
 * ① 세션 목록. 스트림이 아니라 JSON 한 덩어리라 c.json 으로 끝. REST Client 로 보인다.
 * ② 프레임워크 없이는: handle 안에 `if (req.method === 'GET' && req.url === CHATS_PATH) { sendJson(res, 200, …); return; }` 가지가 하나 더.
 */
app.get(CHATS_PATH, (c) => c.json(history.listChats(CHATS_LIMIT)));

const CHAT_BY_ID_PATH = '/api/chats/:id';

/**
 * ① 세션 하나의 메시지 전체. 경로의 :id 자리를 c.req.param('id') 로 꺼낸다. 없는 id 면 빈 배열.
 * ② 프레임워크 없이는: `if (req.url.startsWith('/api/chats/')) { const id = req.url.slice('/api/chats/'.length); … }` — 글자를 잘라 id 를 뽑았다.
 */
/** TODO: 없는 id 일 때 [] 로 줄지 404 로 할지 */
app.get(CHAT_BY_ID_PATH, (c) => {
  /**
   * param 의 결과는 string | undefined. 경로 글자를 변수(CHAT_BY_ID_PATH)로 넘겨서 Hono 가 ":id 가 있다" 를 타입으로 못 보기 때문.
   * 글자 그대로('/api/chats/:id') 적으면 string 으로 잡힌다. 변수로 둔 대신 가드 한 줄.
   */
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id 가 없다' }, 400);
  return c.json(history.loadChat(id));
});

/**
 * ① 핸들러 밖으로 샌 throw 를 마지막에 받는다. 안 받으면 요청 하나 실패로 서버가 죽는다.
 * ② 프레임워크 없이는: handle(req, res).catch((e) => sendJson(res, 500, {...})) — createServer 콜백에서 직접 붙였다.
 * ③ https://hono.dev/docs/api/hono#error-handling
 */
app.onError((e, c) => c.json({ error: e.message }, 500));

/**
 * ① 서버 열기. node 의 req/res 를 표준 Request 로 바꿔 app.fetch 에 넘기고, 돌려받은 Response 를 res 에 쓴다.
 *    hostname 127.0.0.1 = 이 PC 에서만 접속. 빼면 회사망의 다른 PC 도 붙는다.
 * ② 프레임워크 없이는: const server = createServer(...); server.listen(PORT, '127.0.0.1', () => console.log(...));
 * ③ https://hono.dev/docs/getting-started/nodejs
 */
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) =>
  console.log(`http://${info.address}:${info.port}${CHAT_PATH} 에서 대기`),
);

/**
 * Ctrl+C 로 끝낼 때. 열린 연결과 DB 를 닫고 나간다. DB 를 안 닫으면 마지막 저장이 파일에 안 내려갈 수 있다.
 */
process.on('SIGINT', () => {
  server.close();
  history.close();
  process.exit(0);
});
