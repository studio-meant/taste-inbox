/**
 * Join class names, dropping anything falsy.
 *
 * Exists because CSS Module members are typed `string | undefined` under
 * `noUncheckedIndexedAccess`, so every `` `${styles.a} ${styles.b}` `` would otherwise
 * be a type error — and, worse, would silently render the string "undefined" into the
 * class attribute if the class were ever renamed.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}
