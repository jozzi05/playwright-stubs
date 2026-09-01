export type User = { id: string; name: string }

export async function getUser(id: string): Promise<User> {
  // Stands in for a real transport (fetch/GraphQL/SDK); the tests never care.
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { id, name: 'Real User' }
}
