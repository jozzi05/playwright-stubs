export type TrackEvent = { name: string; meta: { at: number } }

export function track(_event: TrackEvent): void {
  // Would ship to a real analytics backend.
}
