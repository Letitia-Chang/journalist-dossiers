/** Small words inside a name: "Ludwig van Beethoven", "María de la Cruz". */
const PARTICLE = "(?:de|da|di|do|dos|du|del|della|la|le|van|von|der|den|ter|ten|bin|ibn|bint|al|el|y|e)";
const PART = "(?:(?:al|el|bin|ibn)-|[dl]['’])?\\p{Lu}[\\p{L}\\p{M}'’.-]*";
const NAME = new RegExp(`^${PART}(?: (?:${PARTICLE} ){0,2}${PART}){1,3}$`, 'u');
const NOT_A_PERSON = /^(admin|staff|editor|editors|editorial|webmaster|noreply|newsroom|contributor|guest|team|the)\b|\b(staff|team|desk|editors|newsroom|wire|news)$|\b(associated|united|canadian|free) press\b|^agence\b/i;

/** Text as one person's name with tidy spacing, or null if it doesn't look like one. Any language with capital letters. */
export function personName(text: string): string | null {
  const name = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  return name.length >= 3 && name.length <= 200 && NAME.test(name) && !NOT_A_PERSON.test(name) ? name : null;
}
