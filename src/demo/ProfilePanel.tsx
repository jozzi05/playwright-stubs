import { useEffect, useState } from 'react'
import { defaults, fetchProfile, getSetting } from './services'

export function ProfilePanel({ id }: { id: string }) {
  const [alias, setAlias] = useState('loading')

  useEffect(() => {
    let cancelled = false
    fetchProfile(id).then((profile) => {
      if (!cancelled) setAlias(profile.alias)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div>
      <span data-testid="alias">{alias}</span>
      <span data-testid="theme">{getSetting('theme')}</span>
      <span data-testid="default-theme">{defaults.theme}</span>
    </div>
  )
}
