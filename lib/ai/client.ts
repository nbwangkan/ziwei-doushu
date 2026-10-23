import { readSseData } from './sse';

/** API failures are user-facing Chinese messages, never raw provider responses. */
export async function checkInterpretationResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let message = response.status === 404
    ? '尚未加载 AI 接口。请同步最新代码，并重新启动开发服务器。'
    : 'AI 请求失败，请稍后重试。';
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      message = body.error;
    }
  } catch { /* Keep a clear fallback for non-JSON proxy errors. */ }
  throw new Error(message);
}

/** Returns cumulative text and rejects interrupted/malformed streams. */
export async function readInterpretationStream(
  body: ReadableStream<Uint8Array> | null,
  onText: (text: string) => void,
): Promise<void> {
  if (!body) throw new Error('AI 没有返回内容，请稍后重试。');
  let text = '';
  let completed = false;
  for await (const data of readSseData(body)) {
    if (data === '[DONE]') {
      completed = true;
      break;
    }
    let event: { delta?: { text?: unknown }; error?: unknown };
    try { event = JSON.parse(data); }
    catch { throw new Error('AI 返回内容格式异常，请稍后重试。'); }
    if (typeof event.error === 'string') throw new Error(event.error);
    if (typeof event.delta?.text === 'string') {
      text += event.delta.text;
      onText(text);
    }
  }
  if (!completed) throw new Error('AI 响应中断，请稍后重试。');
  if (!text.trim()) throw new Error('AI 返回了空内容，请换个问题后重试。');
}
