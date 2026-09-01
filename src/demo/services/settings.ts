export const defaults = { theme: 'dark' }

export function getSetting(key: keyof typeof defaults): string {
  return defaults[key]
}
