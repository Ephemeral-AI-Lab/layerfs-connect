import { call } from './client'
export type DoctorTarget = 'host' | 'machine' | 'sandbox' | 'store.integrity' | 'store.connection' | 'backup.connection'
export interface DoctorRequest { target: DoctorTarget; name?: string; quick?: boolean; write_test?: boolean; timeout?: string }
export interface TargetedReport {
  ok: boolean; complete: boolean; target: { kind: string; name: string }; operation: string; mode: string
  observed_at_ms: number; duration_ms: number; truncated: boolean; counts: Record<string, unknown>
  findings: { severity: string; message: string; entity?: unknown; fix?: string }[]
  checks: { id: string; code: string; outcome: string; severity?: string; message: string; evidence?: unknown; blocked_by?: unknown; fix?: string }[]
}
export interface DoctorJob { id: string; state: 'queued' | 'running' | 'completed' | 'interrupted' | 'failed' | 'unavailable'; request: DoctorRequest; created: number; started?: number; ended?: number; error?: string; simulated: boolean; report?: TargetedReport }
export const doctorApi = {
  launch: (request: DoctorRequest, key: string) => call<DoctorJob>('POST', '/api/doctor-jobs', { ...request, key }),
  list: () => call<DoctorJob[]>('GET', '/api/doctor-jobs'),
  get: (id: string) => call<DoctorJob>('GET', `/api/doctor-jobs/${encodeURIComponent(id)}`),
}
