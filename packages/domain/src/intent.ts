export function requestsTeamSwitch(text: string): boolean {
  const ownTeam = /\b(?:my|our)\s+(?:human|sales)\s+team\b/i.test(text);
  const asks = /\b(?:switch|transfer|connect|talk|speak|chat)(?:\s+\w+){0,5}\s+(?:to|with)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:sales team|human team|person|human|someone)\b/i.test(text);
  return asks && !ownTeam;
}

export function deterministicIntent(text: string): { human: boolean; optOut: boolean } {
  const human = /\b(?:real person|live agent|real agent|human agent|someone from the team|(?:talk|speak|chat|connect)(?: me)? (?:to|with) (?:a |an )?(?:person|human|agent|someone)|(?:want|need|get) (?:a |an )?human)\b/i.test(text);
  const optOut = /\b(stop|unsubscribe|opt[- ]?out|do not (?:message|contact)|don't (?:message|contact)|dont (?:message|contact)|leave me alone|stop messaging|stop texting)\b/i.test(text);
  return { human, optOut };
}
