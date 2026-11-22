import { request, type ApiPost, type ApiPlaceListItem } from './client'
export type DiscoveryFilter = 'all'|'photos'|'recent'|'stories'|'checkins'
export interface DiscoveryPlace extends ApiPlaceListItem { description: string|null; updatedAt:string|null; coverMediaId:string|null }
export interface DiscoveryQuery { filter:DiscoveryFilter;sort:'latest'|'hot';bounds?:string;near?:string;placeId?:string;q?:string;schoolId?:string;category?:string }
export interface DiscoveryResult { asOf:string;total:number;totalKind?:'places';items:ApiPost[];places:DiscoveryPlace[];placesTruncated:boolean;nextCursor:string|null }
export function getMapDiscovery(query:DiscoveryQuery,cursor?:string) {
  const params=new URLSearchParams()
  for(const [key,value] of Object.entries({...query,cursor}))if(value)params.set(key,value)
  return request<DiscoveryResult>(`/api/map/discover?${params}`)
}
