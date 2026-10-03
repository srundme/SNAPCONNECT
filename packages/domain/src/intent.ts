export function deterministicIntent(text: string): { human: boolean; optOut: boolean } {
  const human = /\b(human|real person|agent|staff|someone from the team|talk to (a )?person)\b/i.test(text);
  const optOut = /\b(stop|unsubscribe|opt out|do not message|don't message|dont message)\b/i.test(text);
  return { human, optOut };
}
