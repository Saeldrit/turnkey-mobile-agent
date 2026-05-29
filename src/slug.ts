/** Derive a short kebab-case slug from arbitrary text. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-");
  return s.length >= 2 ? s.slice(0, 40) : "mobile-app";
}
