/**
 * Glob simple (`*` = n chars, `?` = 1 char) sans regex.
 * Parcours lineaire (pas de backtracking exponentiel) : R1 red team Bob 14/10.
 */
export function matchSimpleGlob(name: string, pattern: string): boolean {
  let si = 0;
  let pi = 0;
  let star = -1;
  let match = 0;

  while (si < name.length) {
    if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === name[si])) {
      si += 1;
      pi += 1;
    } else if (pi < pattern.length && pattern[pi] === '*') {
      star = pi;
      pi += 1;
      match = si;
    } else if (star !== -1) {
      pi = star + 1;
      match += 1;
      si = match;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === '*') {
    pi += 1;
  }
  return pi === pattern.length;
}
