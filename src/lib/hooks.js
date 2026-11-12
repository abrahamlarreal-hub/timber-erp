import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, rpc, sel } from './supabase'
import { useToast } from '../components/ui.jsx'

export const useItems = () => useQuery({
  queryKey: ['items'],
  queryFn: () => sel(supabase.from('items').select('*, supplier:suppliers(id,name,lead_time_days)').order('sku')),
})
export const useLocations = () => useQuery({
  queryKey: ['locations'],
  queryFn: () => sel(supabase.from('locations').select('*').order('id')),
  staleTime: 300_000,
})
export const useSuppliers = () => useQuery({
  queryKey: ['suppliers'],
  queryFn: () => sel(supabase.from('suppliers').select('*').order('name')),
})
export const useCustomers = () => useQuery({
  queryKey: ['customers'],
  queryFn: () => sel(supabase.from('customers').select('*').order('name')),
})
export const useReasons = () => useQuery({
  queryKey: ['reasons'],
  queryFn: () => sel(supabase.from('reason_codes').select('*').order('code')),
  staleTime: 300_000,
})
export const useSettings = () => useQuery({
  queryKey: ['settings'],
  queryFn: async () => {
    const rows = await sel(supabase.from('settings').select('*').order('sort'))
    const map = {}; rows.forEach((r) => { map[r.key] = r.value ?? r.text_value })
    return { rows, map }
  },
})
export const useInventory = () => useQuery({
  queryKey: ['inventory'],
  queryFn: () => sel(supabase.from('inventory').select('*')),
})
export const usePolicy = () => useQuery({
  queryKey: ['policy'],
  queryFn: () => sel(supabase.from('v_inventory_policy').select('*').order('sku')),
})
export const useRpcQuery = (fn, args = {}, opts = {}) => useQuery({
  queryKey: ['rpc', fn, args],
  queryFn: () => rpc(fn, args),
  ...opts,
})

// Mutation wrapper with toast feedback + global refresh
export function useAction(fn, { success, onSuccess } = {}) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      qc.invalidateQueries()
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success)
      onSuccess?.(data, vars)
    },
    onError: (e) => toast.error(e.message),
  })
}
