/**
 * OpenRouter 를 사내 중계 서버(route.sqnotes.com)로 보내는 공통 설정.
 * 주소 하나와 헤더 하나만 바꾸면 OpenRouter 를 그대로 쓴다. OpenRouter 를 부르는 파일은 전부 이 둘을 가져다 쓴다.
 */
import 'dotenv/config';

const id = process.env.SQNOTES_ID;
const pw = process.env.SQNOTES_PW;

/**
 * 아이디·비밀번호 가드. IF … IS INITIAL. MESSAGE … TYPE 'E'. 와 같다.
 * 없으면 중계 서버가 401 (WWW-Authenticate: Basic) 만 주고 원인을 못 찾는다.
 */
if (!id || !pw) throw new Error('SQNOTES_ID, SQNOTES_PW 없음. .env 를 확인한다');

/**
 * OpenRouter 의 https://openrouter.ai/api 자리에 들어가는 주소. 뒤 경로(/v1/chat/completions 등)는 OpenRouter 와 같다.
 */
export const ROUTE_URL = 'https://route.sqnotes.com/api';

/**
 * 중계 서버 인증 헤더. 서버가 확인한 뒤 떼어내므로 OpenRouter 로는 안 간다.
 * Authorization: Bearer <OpenRouter 키> 는 지금처럼 따로 붙인다. 값은 로그·에러에 남기지 않는다.
 */
export const ROUTE_HEADERS = {
  'X-Route-Auth': 'Basic ' + Buffer.from(`${id}:${pw}`).toString('base64'),
};
