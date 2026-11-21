/**
 * Review Bob 15/11 (M2) : caracteres invisibles ou sans dessin, retires du texte qu une prise
 * renvoie a un agent (ADR-0012 A12, A13 : contenu non fiable, valeurs courtes).
 *
 * - balises Unicode U+E0020..U+E007F : une phrase entiere cachee, qu un modele lit mais qu un
 *   humain ne voit pas (mesure : « Sauvegarde » + 34 caracteres caches passaient) ;
 * - sens d ecriture (U+202A..U+202E, U+2066..U+2069), largeur nulle (U+200B..U+200F,
 *   U+2060..U+2064, U+FEFF) : texte maquille a l affichage ;
 * - selecteurs de variante, zone privee, non attribues : autres facons de cacher des octets ;
 * - moitie de caractere (paire de substitution coupee par un slice).
 *
 * Tout est retire SANS espace (sinon « co ll ec te »).
 */
const INVISIBLES = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Variation_Selector}]/gu;

export function retirerInvisibles(s: string): string {
  return s.replace(INVISIBLES, '');
}
