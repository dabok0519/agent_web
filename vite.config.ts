/**
 * Vite(브라우저 개발 서버) 설정. npm run web 이 읽는다.
 * 세 가지만 알려 준다: 어디서(root) · 무엇으로(plugins) · 어디로(proxy).
 */
import { defineConfig } from 'vite';

/**
 * .tsx 안의 JSX(<div>…</div>)를 브라우저가 읽는 JS 로 바꾸는 변환기. 없으면 main.tsx 의 첫 <div> 에서 멈춘다.
 * 저장하면 새로고침 없이 화면만 갈아끼우는 기능(HMR)도 React 에 맞게 해 준다.
 */
import react from '@vitejs/plugin-react';

/** TODO: Hono 서버 주소. src/web/server.ts 의 PORT 와 같아야 한다 */
const API_SERVER = 'http://127.0.0.1:9000';

export default defineConfig({
  /** index.html 이 있는 폴더. 브라우저 코드는 전부 여기 밑 */
  root: 'src/ui',
  plugins: [react()],
  server: {
    /**
     * /api 로 시작하는 요청은 Hono 서버로 넘긴다. 브라우저 코드는 '/api/chat' 만 적고 포트를 모른다.
     * 없으면 fetch('/api/chats') 가 5173 으로 가서 404. 다른 주소(9000)로 직접 보내면 브라우저 CORS 규칙에 걸린다.
     */
    proxy: { '/api': API_SERVER },
  },
});
