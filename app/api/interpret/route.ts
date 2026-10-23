import { handleInterpretation } from '@/lib/ai/interpret';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  return handleInterpretation(request);
}
