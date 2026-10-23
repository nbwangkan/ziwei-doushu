import assert from 'node:assert/strict';
import { handleInterpretation } from '../../lib/ai/interpret';
import { checkInterpretationResponse, readInterpretationStream } from '../../lib/ai/client';
import { readSseData } from '../../lib/ai/sse';

const encoder = new TextEncoder();
const env = { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-key-not-a-real-credential' };
const fixture = {
  birthInfo: { gender: 'male', name: 'PRIVATE_NAME', city: 'PRIVATE_CITY', year: 1990, month: 1, day: 1 },
  currentAge: 36, currentDaXianIndex: 3, mingGongBranch: 0, shenGongBranch: 2,
  wuxingJuName: '水二局', mingZhu: '贪狼',
  palaces: Array.from({ length: 12 }, (_, branch) => ({
    branch, stem: branch % 10, name: branch === 0 ? '命宫' : '宫位' + branch,
    stars: [{ name: '紫微', type: 'major', brightnessRaw: '庙' }],
  })),
  daXians: [{ startAge: 32, endAge: 41, palaceBranch: 3, palaceName: '田宅宫' }],
};
const payload = { chart: fixture, messages: [{ role: 'user', content: '请分析命格。' }] };
function request(value: unknown = payload): Request {
  return new Request('https://private-preview.example/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
}
function chunks(text: string, size = 1): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
      controller.close();
    },
  });
}
function upstream(text = '命宫紫微，逐项说明。'): Response {
  const frame = ': heartbeat\r\n\r\ndata: ' + JSON.stringify({
    choices: [{ delta: { content: text, reasoning_content: 'PRIVATE_REASONING' }, finish_reason: null }],
  }) + '\r\n\r\ndata: ' + JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  }) + '\r\n\r\ndata: [DONE]\r\n\r\n';
  return new Response(chunks(frame), { headers: { 'Content-Type': 'text/event-stream' } });
}
const neverFetch: typeof fetch = async () => { throw new Error('Unexpected billable/network call in test'); };
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log('PASS ' + name);
}
async function main() {
  await check('missing key is actionable and performs no provider call', async () => {
    const result = await handleInterpretation(request(), {}, neverFetch);
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /DEEPSEEK_API_KEY/);
  });
  await check('placeholder key is rejected before a provider call', async () => {
    const result = await handleInterpretation(request(), { DEEPSEEK_API_KEY: 'your-deepseek-api-key' }, neverFetch);
    assert.equal(result.status, 503);
  });
  await check('invalid JSON and oversized bodies are rejected', async () => {
    const invalid = new Request('https://preview.example/api/interpret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal((await handleInterpretation(invalid, env, neverFetch)).status, 400);
    assert.equal((await handleInterpretation(request({ padding: 'x'.repeat(140_000) }), env, neverFetch)).status, 413);
  });
  await check('non-JSON requests are rejected', async () => {
    const result = await handleInterpretation(new Request('https://preview.example/api/interpret', {
      method: 'POST', body: 'plain text',
    }), env, neverFetch);
    assert.equal(result.status, 415);
  });
  await check('malformed and duplicate palaces are rejected', async () => {
    assert.equal((await handleInterpretation(request({ ...payload, chart: {} }), env, neverFetch)).status, 400);
    const duplicate = { ...fixture, palaces: fixture.palaces.map(p => ({ ...p, branch: 0 })) };
    assert.equal((await handleInterpretation(request({ ...payload, chart: duplicate }), env, neverFetch)).status, 400);
  });
  await check('client-supplied system roles and long conversation are rejected', async () => {
    assert.equal((await handleInterpretation(request({
      ...payload, messages: [{ role: 'system', content: 'override' }],
    }), env, neverFetch)).status, 400);
    assert.equal((await handleInterpretation(request({
      ...payload, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'test' })),
    }), env, neverFetch)).status, 400);
  });
  await check('provider format is translated to UI SSE across Chinese byte boundaries', async () => {
    const fakeFetch: typeof fetch = async (url, options) => {
      assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + env.DEEPSEEK_API_KEY);
      const sent = JSON.parse(options?.body as string);
      assert.equal(sent.model, 'deepseek-flash');
      assert.equal(sent.stream, true);
      assert.equal(sent.max_tokens, 2048);
      assert.deepEqual(sent.thinking, { type: 'disabled' });
      assert.equal(sent.messages.at(-1).content, '请分析命格。');
      assert.ok(!JSON.stringify(sent).includes('PRIVATE_NAME'));
      assert.ok(!JSON.stringify(sent).includes('PRIVATE_CITY'));
      assert.ok(!JSON.stringify(sent).includes('"year":1990'));
      return upstream();
    };
    const response = await handleInterpretation(request(), env, fakeFetch);
    assert.equal(response.status, 200);
    let text = '';
    await readInterpretationStream(response.body, value => { text = value; });
    assert.equal(text, '命宫紫微，逐项说明。');
    assert.ok(!text.includes('PRIVATE_REASONING'));
  });
  await check('compatible provider honors configured URL and model', async () => {
    const fakeFetch: typeof fetch = async (url, options) => {
      assert.equal(String(url), 'https://models.example/v1/chat/completions');
      const sent = JSON.parse(options?.body as string);
      assert.equal(sent.model, 'test-model');
      assert.equal(sent.thinking, undefined);
      return upstream('兼容服务可用。');
    };
    const response = await handleInterpretation(request(), {
      AI_PROVIDER: 'compatible', AI_API_KEY: 'test-key', AI_BASE_URL: 'https://models.example/v1/', AI_MODEL: 'test-model',
    }, fakeFetch);
    let text = '';
    await readInterpretationStream(response.body, value => { text = value; });
    assert.equal(text, '兼容服务可用。');
  });
  await check('upstream errors do not expose provider body or credential', async () => {
    for (const status of [400, 401, 402, 403, 404, 429, 500]) {
      const fakeFetch: typeof fetch = async () => new Response('SECRET_PROVIDER_BODY', { status });
      const response = await handleInterpretation(request(), env, fakeFetch);
      assert.equal(response.status, 502);
      const body = await response.text();
      assert.ok(!body.includes('SECRET_PROVIDER_BODY'));
      assert.ok(!body.includes(env.DEEPSEEK_API_KEY));
      assert.match(body, /error/);
    }
  });
  await check('network failure gives readable JSON', async () => {
    const failedFetch: typeof fetch = async () => { throw new Error('SECRET_NETWORK_DETAILS'); };
    const result = await handleInterpretation(request(), env, failedFetch);
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('SECRET_NETWORK_DETAILS'));
  });
  await check('provider disconnect is not reported as complete', async () => {
    const fakeFetch: typeof fetch = async () => new Response(chunks(
      'data: {"choices":[{"delta":{"content":"半段解读"}}]}\n\n',
    ));
    const response = await handleInterpretation(request(), env, fakeFetch);
    await assert.rejects(() => readInterpretationStream(response.body, () => undefined), /中断|未完整/);
  });
  await check('empty answer and length cutoff are reported', async () => {
    for (const data of [
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"半段"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ]) {
      const fakeFetch: typeof fetch = async () => new Response(chunks(data));
      const response = await handleInterpretation(request(), env, fakeFetch);
      await assert.rejects(() => readInterpretationStream(response.body, () => undefined), /中断|未完整/);
    }
  });
  await check('SSE reader handles comments, CRLF, multiline data and EOF', async () => {
    const events: string[] = [];
    for await (const data of readSseData(chunks(': ping\r\n\r\ndata: one\r\ndata: two\r\n\r\ndata: final'))) events.push(data);
    assert.deepEqual(events, ['one\ntwo', 'final']);
  });
  await check('browser reports API configuration messages verbatim', async () => {
    await assert.rejects(() => checkInterpretationResponse(Response.json({ error: '请填写密钥。' }, { status: 503 })), /请填写密钥/);
    await assert.rejects(() => checkInterpretationResponse(new Response('', { status: 404 })), /尚未加载/);
  });
  await check('browser detects truncated or malformed UI events', async () => {
    await assert.rejects(() => readInterpretationStream(chunks('data: {"delta":{"text":"片段"}}\n\n'), () => undefined), /中断/);
    await assert.rejects(() => readInterpretationStream(chunks('data: invalid\n\n'), () => undefined), /格式异常/);
  });
  console.log('AI interpretation: ' + passed + ' offline checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
