import { ProfilePanel } from './ProfilePanel'

export function Default({ id = '1' }: { id?: string }) {
  return <ProfilePanel id={id} />
}
