import type { BlameOrigin } from './FileBlame'
export interface SavedOwner { ref: { id: string; branch?: string | null }; message?: string }
/** An absent originating Branch remains unknown; it is never inferred as main. */
export function savedOrigin(value?: SavedOwner | null): BlameOrigin | null {
  return value ? { id: value.ref.id, branch: value.ref.branch ?? null, message: value.message ?? 'Saved origin' } : null
}
export function comparisonBranch(leftBranch: string | undefined, viewedBranch: string): string {
  return leftBranch ?? viewedBranch
}
