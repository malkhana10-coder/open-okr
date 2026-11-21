/**
 * What an upload reports back. Its own module because `actions.ts` carries
 * `"use server"`, and such a module may only export async functions.
 */
export interface DocumentUploadState {
  /** A refusal in words, or null. */
  readonly error: string | null;
  /** True once a document was registered, so the form can say so. */
  readonly saved?: boolean;
  /**
   * What was typed, handed back with a refusal. React empties a form when
   * its action returns, and a person told "choose a PDF first" should not
   * have to type the title again.
   */
  readonly values?: {
    readonly title: string;
    readonly kind: string;
    readonly year: string;
  };
}

export const NO_UPLOAD: DocumentUploadState = { error: null };
