/**
 * 브라우저 쪽 입구. 뼈대 5-3-a (2026-10-08): useChat + text 그리기 + 입력창. 도구 줄(b)·상태 표시(c)는 다음.
 * 이 파일은 node 가 아니라 브라우저에서 돈다. process·Buffer 같은 서버 단어는 못 쓴다.
 */

/**
 * createRoot: html 의 빈 자리에 React 를 붙이는 함수 (react-dom).
 * React 는 "데이터 → 그림 함수" 를 등록해 두고 데이터가 바뀔 때마다 다시 그린다.
 */
import { createRoot } from 'react-dom/client';

/**
 * useState: 값 하나를 기억하는 칸. [값, 바꾸는 함수] 를 돌려준다. 입력창 글자에 쓴다.
 */
import { useState } from 'react';

/**
 * ① useChat: 브라우저 쪽 AI SDK. messages(대화)·sendMessage(보내기) 를 주고,
 *    서버에 { id, trigger, messages } 를 POST 하고 SSE 조각을 받아 message.parts 로 뭉치는 일을 전부 안에서 한다.
 *    curl 로 body.json 을 만들고 data: 줄을 눈으로 보던 그 두 일이 이 훅 안에 있다.
 * ② 안 쓰면: fetch 로 직접 POST 하고 data: 줄을 읽어 parts 를 손으로 뭉쳐야 한다(processUIMessageStream 을 우리가 다시 쓰는 셈).
 * ③ https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
 */
import { useChat } from '@ai-sdk/react';

/**
 * ① DefaultChatTransport: "어디로, 어떤 모양으로 보낼지". api 경로만 주면 기본 모양({ id, trigger, messages })으로 POST 한다.
 * ② 안 쓰면: useChat 기본값이 '/api/chat' 이라 사실 같다. 경로를 바꾸거나(뼈대 5-4 없음) 헤더를 붙일 때 이 자리.
 *    TextStreamChatTransport 는 글자만 받고 도구 part 가 없어 우리 목적에 안 맞는다.
 * ③ https://ai-sdk.dev/docs/ai-sdk-ui/transport
 */
import { DefaultChatTransport } from 'ai';

/** TODO: 화면 맨 위 제목 글자 */
const TITLE = 'web ui';

/** TODO: 채팅 경로. src/server.ts 의 CHAT_PATH 와 같아야 한다. Vite 프록시가 /api 를 9000 으로 넘긴다 */
const CHAT_API = '/api/chat';

/** TODO: 입력창 안내 문구 (예: 문서번호 형식) */
const PLACEHOLDER = '음...물어보세요';

/**
 * 컴포넌트 = 그림을 돌려주는 함수. 세 덩어리: 상태(훅 둘) → 그림(messages.map) → 입력(form).
 * 훅은 함수 맨 위에서만 부른다. 조건문·반복문 안에서는 안 된다(React 규칙).
 */
function App() {
  /**
   * 대화 상태. messages 는 처음엔 []. sendMessage 가 user 메시지를 넣고 POST 하면,
   * 조각이 올 때마다 useChat 이 messages 를 바꾸고 React 가 App 을 다시 실행해 아래 map 이 다시 돈다.
   */
  const { messages, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: CHAT_API }),
  });

  /**
   * 입력창 글자. 타이핑마다 setText, 보내면 비운다. 보낸 뒤 대화는 messages 가 들고 있고 text 는 역할이 끝난다. (<input> 태그와 헷갈리지 않게 input 이 아니라 text)
   */
  const [text, setText] = useState('');

  return (
    <div>
      <h1>{TITLE}</h1>

      {/*
        LOOP AT messages. 메시지마다 <div> 하나, 그 안에서 parts 를 또 돈다.
        key = React 가 "아까 그 줄" 을 알아보는 표. 메시지는 id, part 는 순서.
        지금은 type:'text' 만 그린다. reasoning·step-start·tool 은 null(안 그림). 도구 줄은 뼈대 b 에서.
      */}
      {messages.map((m) => (
        <div key={m.id}>
          <b>{m.role}</b>
          {m.parts.map((p, i) => (p.type === 'text' ? <p key={i}>{p.text}</p> : null))}
        </div>
      ))}

      {/*
        보내기. preventDefault 가 없으면 form 기본 동작(페이지 새로고침)으로 대화가 날아간다.
        sendMessage({ text }) → useChat 이 user 메시지를 messages 에 넣고(즉시 그려짐) 서버로 POST.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void sendMessage({ text });
          setText('');
        }}
      >
      {/*
      input : 브라우저에 입력하는 창 
      
      */}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} />
        <button>보내기</button>
      </form>
    </div>
  );
}

/**
 * index.html 의 <div id="root"> 를 찾아 거기에 App 을 그린다. 없으면 여기서 멈춘다.
 * document 는 브라우저 단어. tsconfig 의 lib 에 dom 을 넣어야 TS 가 안다.
 */
const root = document.getElementById('root');
if (!root) throw new Error('index.html 에 #root 가 없다');
createRoot(root).render(<App />);
