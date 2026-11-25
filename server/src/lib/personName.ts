/** Small words inside a name: "Ludwig van Beethoven", "María de la Cruz". */
const PARTICLE = "(?:de|da|di|do|dos|du|del|della|la|le|van|von|der|den|ter|ten|bin|ibn|bint|al|el|y|e)";
const PART = "\\p{Lu}[\\p{L}\\p{M}'’.-]*";
const NAME = new RegExp(`^${PART}(?: (?:${PARTICLE}|${PART})){0,4} ${PART}$`, 'u');
const NOT_A_PERSON = /^(admin|staff|editor|editors|editorial|webmaster|noreply|newsroom|contributor|guest|team|the)\b|\b(staff|team|desk|editors|newsroom|wire|press|news)$/i;

/** Whether text looks like one person's name, in any language with capital letters. */
export function isPersonName(text: string): boolean {
  const name = text.normalize('NFC').trim();
  return name.length >= 3 && name.length <= 200 && NAME.test(name) && !NOT_A_PERSON.test(name);
}
