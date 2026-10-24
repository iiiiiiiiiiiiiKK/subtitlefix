let counter = 0;

/**
 * Monotonic id generator. Ids only need to be unique within a session: they are
 * used for React keys, selection state and undo snapshots, never serialised.
 */
export function nextCueId(prefix = 'cue'): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

/** Test helper — resets the counter so snapshots stay deterministic. */
export function resetCueIds(): void {
  counter = 0;
}
