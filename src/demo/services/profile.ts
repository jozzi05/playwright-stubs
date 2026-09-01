export async function fetchProfile(id: string): Promise<{ id: string; alias: string }> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { id, alias: 'real-alias' }
}
