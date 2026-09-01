import client from './client'

export function ClientPanel() {
  return (
    <div>
      <output>{client.get('/users')}</output>
    </div>
  )
}
