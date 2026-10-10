

export function deterministicIntent(text: string): { human: boolean; optOut: boolean } {
  const human = /\b(?:real person|live agent|real agent|human agent|someone from the team|(?:talk|speak|chat|connect)(?: me)? (?:to|with) (?:a |an )?(?:person|human|agent|someone)|(?:want|need|get) (?:a |an )?human)\b/i.test(text);
  // A lone "stop" or "stop messaging" opts out; "stop" inside a sentence ("near the bus stop") does not.
  const optOut = /^\W*(?:(?:please|pls|plz)\s+)?stop\W*(?:(?:please|pls|plz)\W*)?$/i.test(text.trim())
    || /\b(unsubscribe|opt[- ]?out|do not (?:message|contact|text)|don't (?:message|contact|text)|dont (?:message|contact|text)|leave me alone|stop (?:messag\w*|text\w*|send\w*|contact\w*|spam\w*|disturb\w*)|(?:please|pls|plz) stop)\b/i.test(text);
  return { human, optOut };
}
