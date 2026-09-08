import { UserProfile } from './UserProfile'

export function Default({ id = 't' }: { id?: string }) {
  return <UserProfile id={id} />
}
