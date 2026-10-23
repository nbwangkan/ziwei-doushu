/** Read complete SSE data events, preserving UTF-8 and network chunk boundaries. */
export async function* readSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let ended = false;
  try {
    while (!ended) {
      const chunk = await reader.read();
      ended = chunk.done;
      buffer += ended ? decoder.decode() + '\n\n' : decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (buffer.length + data.reduce((total, line) => total + line.length, 0) > 1_048_576) {
        throw new Error('AI 响应事件过大，请缩小问题后重试。');
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
