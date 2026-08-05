import type { AgentTransport } from '../agent/types.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS } from './find.js';

export interface ChatTurn {
  role: 'user' | 'agent';
  text: string;
}

export interface ChatSession {
  /** Agent SDK session id, so follow-ups resume rather than start over. */
  id: string | null;
  turns: ChatTurn[];
}

export interface ReviewUnitLike {
  path: string;
  header: string;
  lines: Array<{ kind: 'context' | 'add' | 'del'; text: string }>;
}

export function buildChatContext(unit: ReviewUnitLike): string {
  const body = unit.lines
    .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');
  return `File: ${unit.path}\n${unit.header}\n${body}`;
}

const CHAT_SYSTEM_PROMPT =
  'You are answering questions about a pull request under review. You have read-only access to the repository at the head commit. Answer concretely and briefly; read the code before speculating. If you do not know, say so.';

/**
 * Answers one question about the hunk under the reviewer's cursor. Never
 * throws: losing an answer is a nuisance, but the review itself must remain
 * usable even when the model is unreachable.
 */
export async function ask(
  transport: AgentTransport,
  model: string,
  session: ChatSession,
  question: string,
  cwd: string,
): Promise<ChatSession> {
  const turns: ChatTurn[] = [...session.turns, { role: 'user', text: question }];

  try {
    const run = await transport.run({
      model,
      cwd,
      systemPrompt: CHAT_SYSTEM_PROMPT,
      prompt: question,
      allowedTools: [...READ_ONLY_TOOLS],
      disallowedTools: [...DENIED_TOOLS],
      ...(session.id ? { resume: session.id } : {}),
    });
    return { id: run.sessionId, turns: [...turns, { role: 'agent', text: run.text }] };
  } catch {
    return {
      id: session.id,
      turns: [...turns, { role: 'agent', text: 'Could not reach the model. Your review is unaffected.' }],
    };
  }
}
