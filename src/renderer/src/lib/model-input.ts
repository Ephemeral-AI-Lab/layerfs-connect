/** Missing API metadata says nothing about support; let the provider decide. */
export function imageInputSupport(input?: readonly string[]): boolean | undefined {
  return input?.length ? input.includes('image') : undefined
}
