/**
 * 브라우저 쪽 입구. 5-5 (2026-10-08): 그리는 부분을 전부 Vercel AI Elements 컴포넌트로 교체.
 * useChat·sendMessage·status·사이드바 fetch 같은 "동작" 은 그대로다. 바뀐 건 <div>·<p>·<form> 이 <Message>·<Tool>·<PromptInput> 이 된 것.
 * 이 파일은 node 가 아니라 브라우저에서 돈다. process·Buffer 같은 서버 단어는 못 쓴다.
 */

/**
 * createRoot: html 의 빈 자리에 React 를 붙이는 함수 (react-dom).
 */
import { createRoot } from 'react-dom/client';

/**
 * useState: 값 하나를 기억하는 칸. useEffect: "처음 뜰 때 한 번 이걸 해라".
 */
import { useState, useEffect } from 'react';

/**
 * Tailwind + shadcn 테마 변수. AI Elements 컴포넌트가 쓰는 bg-primary·text-muted-foreground 같은 이름이 여기서 정의된다.
 */
import './globals.css';

/**
 * ① useChat: 브라우저 쪽 AI SDK. messages·sendMessage·status·stop 을 준다. 서버에 { id, trigger, messages } 를 POST 하고 조각을 받아 parts 로 뭉친다.
 * ② 안 쓰면: fetch 와 data: 줄 파싱, parts 뭉치기를 손으로.
 * ③ https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
 */
import { useChat } from '@ai-sdk/react';

/**
 * DefaultChatTransport: 어디로 보낼지. generateId: 새 채팅 id. UIMessage: 불러온 이력 타입. isStaticToolUIPart: part 가 tool-… 인지.
 */
import { DefaultChatTransport, generateId, isStaticToolUIPart, type UIMessage } from 'ai';

/**
 * AI Elements (Vercel). shadcn 방식이라 패키지가 아니라 src/ui/components/ai-elements/ 에 소스로 들어와 있다.
 * Conversation = 대화 영역(자동 스크롤). Message = 말풍선(user 오른쪽·assistant 왼쪽). MessageResponse = 마크다운 답(Streamdown).
 * Tool = 접히는 도구 카드(헤더 배지 + input/output). PromptInput = 입력창(status 에 따라 보내기/중지 아이콘).
 * https://elements.ai-sdk.dev/components
 */
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
/**
 * Reasoning: 모델의 생각 과정(reasoning part)을 접히는 상자로. isStreaming 이면 "Thinking…" 과 걸린 시간을 보여 주고 끝나면 자동으로 접힌다.
 */
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';

/** TODO: 사이드바 맨 위 제목 */
const TITLE = 'SAP 조회 도우미';

/** TODO: 채팅 경로. src/server.ts 의 CHAT_PATH (POST) */
const CHAT_API = '/api/chat';

/** TODO: 세션 목록·불러오기 경로. src/server.ts 의 CHATS_PATH (GET). 불러오기는 뒤에 /id */
const CHATS_API = '/api/chats';

/** TODO: 새 채팅 버튼 글자 */
const NEW_CHAT_LABEL = '＋ 새 채팅';

/** TODO: 입력창 안내 문구 */
const PLACEHOLDER = '구매오더(45…)·자재(SMPS) 등을 물어보세요';

/**
 * 세션 목록 한 줄 모양. 서버 GET /api/chats 가 주는 것과 같다 (src/history.ts 의 ChatRow).
 */
type ChatRow = { id: string; title: string; updatedAt: string };

/**
 * 채팅 한 판. id·initial 은 부모(App)가 넘긴다. 세션을 바꾸면 App 이 key 를 바꿔 이 컴포넌트를 통째로 새로 만든다.
 */
function Chat({ id, initial }: { id: string; initial: UIMessage[] }) {
  /**
   * useChat 에 id·messages 를 넣으면 "이 세션을 이 이력으로 시작". 둘 다 처음 만들 때 한 번만 읽는다.
   */
  const { messages, sendMessage, status, stop } = useChat({
    id,
    messages: initial,
    transport: new DefaultChatTransport({ api: CHAT_API }),
  });

  /** 오는 중이면 입력을 잠근다. 또 보내면 useChat 이 앞 스트림을 끊어 답이 잘린다 */
  const busy = status === 'submitted' || status === 'streaming';

  /** 입력창 글자. PromptInputTextarea 가 value/onChange 로 비춘다 */
  const [text, setText] = useState('');

  /**
   * PromptInput 의 onSubmit. form 의 preventDefault·Enter 처리는 컴포넌트가 한다. message.text 에 입력 글자가 온다.
   */
  function submit(message: PromptInputMessage) {
    if (!message.text.trim()) return;
    void sendMessage({ text: message.text });
    setText('');
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Conversation: 대화 영역. 조각이 올 때마다 바닥으로 따라 내려가고, 위로 올리면 멈춘다(use-stick-to-bottom) */}
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((m) => (
            /* Message from=role: user 는 오른쪽·assistant 는 왼쪽 정렬을 컴포넌트가 한다 */
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((p, i) =>
                  p.type === 'text' ? (
                    /* MessageResponse: 마크다운 → HTML (Streamdown). 표·굵게·제목. 스트리밍 중 토막마다 다시 그린다 */
                    <MessageResponse key={i}>{p.text}</MessageResponse>
                  ) : p.type === 'reasoning' ? (
                    /*
                      Reasoning: 생각 과정. p.state 가 'streaming' 이면 조각이 오는 중(상자가 열려 있고 글자가 자라남), 'done' 이면 접힘.
                      part 의 type 은 'reasoning', 내용은 p.text — text part 와 칸 이름이 같다.
                    */
                    <Reasoning key={i} isStreaming={p.state === 'streaming'}>
                      <ReasoningTrigger />
                      <ReasoningContent>{p.text}</ReasoningContent>
                    </Reasoning>
                  ) : isStaticToolUIPart(p) ? (
                    /*
                      Tool: 접히는 카드. ToolHeader 가 type('tool-searchMaterials')에서 이름을 빼고 state 로 배지(Running/Completed/Error)를 단다.
                      같은 part 의 state 가 바뀌면 배지가 제자리에서 바뀐다. ToolInput/ToolOutput 은 JSON 을 코드블록으로.
                    */
                    <Tool key={i}>
                      <ToolHeader type={p.type} state={p.state} />
                      <ToolContent>
                        <ToolInput input={p.input} />
                        <ToolOutput output={p.output} errorText={p.errorText} />
                      </ToolContent>
                    </Tool>
                  ) : null,
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/*
        PromptInput: form 역할. Enter = 보내기, Shift+Enter = 줄바꿈 을 컴포넌트가 처리한다.
        PromptInputSubmit 은 status 에 따라 아이콘이 바뀐다(대기 ↵ · submitted 로딩 · streaming ■). ■ 일 때 누르면 stop().
      */}
      <div className="border-t p-3">
        <PromptInput onSubmit={submit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              disabled={busy}
            />
          </PromptInputBody>
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              disabled={!busy && !text.trim()}
              onClick={(e) => {
                if (busy) {
                  e.preventDefault();
                  stop();
                }
              }}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

/**
 * 사이드바. 처음 뜰 때 목록을 받아 제목을 나열하고, 클릭·새 채팅을 부모(App)에 알린다.
 * onPick·onNew 는 부모가 넘기는 함수. current 는 지금 세션 id(강조용).
 */
function Sidebar({ current, onPick, onNew }: { current: string; onPick: (id: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<ChatRow[]>([]);

  /**
   * 처음 뜰 때 한 번 목록을 받는다. fetch 는 400·500 이 와도 에러가 안 나므로 res.ok 를 본다. 결과는 타입이 없어 배열인지 본다.
   */
  useEffect(() => {
    fetch(CHATS_API)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as ChatRow[]);
      });
  }, []);

  return (
    <aside className="flex h-full min-w-0 flex-col border-r">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="font-semibold">{TITLE}</div>
        {/* Button: shadcn 기본 버튼. AI Elements 가 같은 걸 쓴다 */}
        <Button type="button" onClick={onNew}>
          {NEW_CHAT_LABEL}
        </Button>
      </div>
      {/* 목록만 자체 스크롤. overflow-y-auto 가 없으면 세션이 많을 때 화면 전체가 늘어난다 */}
      <div className="flex-1 overflow-y-auto p-2">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            className={
              'block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-accent ' +
              (r.id === current ? 'bg-accent font-medium' : '')
            }
          >
            {r.title}
            <div className="text-xs text-muted-foreground">{r.updatedAt.slice(0, 16).replace('T', ' ')}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}

/**
 * 맨 위. "지금 어느 세션인지" 만 들고 있고, 사이드바(고정폭)와 채팅을 나란히 놓는다.
 */
function App() {
  const [chatId, setChatId] = useState(generateId());
  const [initial, setInitial] = useState<UIMessage[]>([]);

  /**
   * 세션 클릭. 메시지를 받아 둘 다 바꾸면 <Chat key> 가 바뀌어 Chat 이 새로 만들어지고 useChat 이 새 id·이력을 읽는다.
   */
  async function pick(id: string) {
    const res = await fetch(`${CHATS_API}/${id}`);
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return;
    setInitial(data as UIMessage[]);
    setChatId(id);
  }

  /** 새 채팅. 새 id + 빈 이력 */
  function fresh() {
    setInitial([]);
    setChatId(generateId());
  }

  /* grid-cols-[240px_1fr]: 왼쪽 240px 고정, 오른쪽 나머지. h-screen: 화면 높이에 맞춰 안쪽이 각자 스크롤 */
  return (
    <div className="grid h-screen grid-cols-[240px_1fr]">
      <Sidebar current={chatId} onPick={pick} onNew={fresh} />
      <Chat key={chatId} id={chatId} initial={initial} />
    </div>
  );
}

/**
 * index.html 의 <div id="root"> 를 찾아 거기에 App 을 그린다. 없으면 여기서 멈춘다.
 */
const root = document.getElementById('root');
if (!root) throw new Error('index.html 에 #root 가 없다');
createRoot(root).render(<App />);
