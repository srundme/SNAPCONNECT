/** A home the firm has really completed, from the team's list on the Agent page. */
export type CompletedProject = { property: string; area: string; home: string; link: string };

/** "Adarsh Palm Retreat | Bellandur | 4 BHK villa | https://…" lines. */
export function parseCompletedProjects(text: string): CompletedProject[] {
  return text.split(/\n+/).flatMap((line) => {
    const [property = "", area = "", home = "", link = ""] = line.split("|").map((part) => part.trim());
    return property.length >= 3 ? [{ property, area, home, link: /^https?:\/\//i.test(link) ? link : "" }] : [];
  }).slice(0, 300);
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/\b(bengaluru|bangalore|blr|phase|tower|block|apartments?|villas?|the)\b/g, " ").split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

/**
 * The completed home in the same property as theirs. Every word of the listed property name has to
 * appear in what they said, so "Prestige Lakeside Habitat" never matches a different Prestige.
 */
export function completedInProperty(place: string, projects: CompletedProject[]): CompletedProject | null {
  const said = new Set(words(place));
  if (!said.size) return null;
  return projects.find((project) => {
    const named = words(project.property);
    return named.length > 0 && named.every((word) => said.has(word) || [...said].some((other) => other.length >= 5 && word.length >= 5 && other.slice(0, 5) === word.slice(0, 5)));
  }) ?? null;
}
