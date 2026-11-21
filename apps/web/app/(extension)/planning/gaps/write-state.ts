/**
 * What a write on the gaps screen reports back. Its own module because
 * `actions.ts` carries `"use server"`, and such a module may only export
 * async functions.
 */
export interface GapWriteState {
  /** A refusal in words, or null. */
  readonly error: string | null;
  /** True once the write completed. */
  readonly saved?: boolean;
  /** What was typed, handed back with a refusal so nothing is retyped. */
  readonly values?: Readonly<Record<string, string>>;
}

export const NO_GAP_WRITE: GapWriteState = { error: null };
