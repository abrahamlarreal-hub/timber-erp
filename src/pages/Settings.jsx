import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Settings as Cog, Save } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useSettings, useAction, useLocations, useReasons } from '../lib/hooks'
import { useAuth } from '../lib/auth.jsx'
import { Button, Card, PageHeader, Table, Field, Input, Select, Badge } from '../components/ui.jsx'

export default function SettingsPage() {
  const s = useSettings().data
  const { isManager, profile } = useAuth()
  const locs = useLocations().data || []
  const reasons = useReasons().data || []
  const users = useQuery({ queryKey: ['profiles'], queryFn: () => sel(supabase.from('profiles').select('*, customer:customers(name)').order('created_at')) }).data || []
  const [vals, setVals] = useState({})
  useEffect(() => { if (s) setVals(Object.fromEntries(s.rows.map((r) => [r.key, r.value ?? r.text_value]))) }, [s])
  const save = useAction(async () => {
    for (const r of s.rows) {
      const patch = r.text_value !== null ? { text_value: vals[r.key] } : { value: Number(vals[r.key]) }
      const { error } = await supabase.from('settings').update(patch).eq('key', r.key)
      if (error) throw new Error(error.message)
    }
  }, { success: 'Settings saved' })
  const setRole = useAction(async ({ id, role }) => { const { error } = await supabase.from('profiles').update({ role }).eq('id', id); if (error) throw new Error(error.message) }, { success: 'Role updated' })
  return (
    <>
      <PageHeader icon={Cog} title="Settings & Users" subtitle={isManager ? 'Managers can edit system settings and user roles' : 'Read-only — ask a manager to change settings'} />
      <Card title="System settings" actions={isManager && <Button loading={save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" />Save</Button>}>
        <div className="grid gap-4 md:grid-cols-3">
          {s?.rows.map((r) => (
            <Field key={r.key} label={r.label} hint={r.description}>
              <Input disabled={!isManager} type={r.text_value !== null ? 'text' : 'number'} step="any" value={vals[r.key] ?? ''} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Users & roles" subtitle="Everyone shares one live database — changes made by any user appear for all others instantly" padded={false}>
          <Table rows={users} columns={[
            { label: 'Name', render: (u) => <div><div className="font-medium">{u.full_name}</div><div className="text-xs text-stone-500">{u.email}</div></div> },
            { label: 'Role', render: (u) => isManager && u.id !== profile.id ? <Select className="w-32 py-1" value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })} options={['manager', 'staff', 'customer'].map((r) => ({ value: r, label: r }))} /> : <Badge>{u.role}</Badge> },
            { label: 'Customer account', render: (u) => u.customer?.name || '' },
          ]} />
        </Card>
        <div className="space-y-5">
          <Card title="Locations" padded={false}><Table rows={locs} dense columns={[{ label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', key: 'kind' }, { label: 'Pickup', render: (l) => (l.pickup ? 'Yes' : '') }, { label: 'Available to sell', render: (l) => (l.sellable ? 'Yes' : 'No') }]} /></Card>
          <Card title="Reason codes" padded={false}><Table rows={reasons} rowKey="code" dense maxHeight={300} columns={[{ label: 'Code', key: 'code' }, { label: 'Description', key: 'description' }, { label: 'Used for', key: 'category' }]} /></Card>
        </div>
      </div>
    </>
  )
}
