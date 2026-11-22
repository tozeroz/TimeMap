import { request, type ApiAdminPost, type ApiMediaRef } from './client'
export interface CuratedPost extends ApiAdminPost {placeId:string|null;campusStory:boolean;images:ApiMediaRef[]}
export interface CuratedPlace {id:string;name:string;address:string|null;enabled:boolean;active:boolean|null;version:number;description:string;validPhotos:number}
export interface CheckinPhoto {postId:string;mediaId:string;valid?:boolean}
export interface CheckinEdit {id:string;name:string;active:boolean;version:number;description:string;photos:CheckinPhoto[]}
export interface CurationPage<T> {items:T[];nextCursor:string|null}
function qs(query:Record<string,string>) {return new URLSearchParams(Object.entries(query).filter(([,v])=>v)).toString()}
export const curationPosts=(query:Record<string,string>)=>request<CurationPage<CuratedPost>>(`/api/admin/curation/posts?${qs(query)}`)
export const curationPlaces=(query:Record<string,string>)=>request<CurationPage<CuratedPlace>>(`/api/admin/curation/places?${qs(query)}`)
export const setCampusStory=(id:string,enabled:boolean)=>request(`/api/admin/curation/posts/${encodeURIComponent(id)}/story`,{method:'PUT',body:{enabled}})
export const getCheckin=(id:string)=>request<CheckinEdit>(`/api/admin/curation/places/${encodeURIComponent(id)}`)
export const saveCheckin=(value:CheckinEdit)=>request<{version:number}>(`/api/admin/curation/places/${encodeURIComponent(value.id)}`,{method:'PUT',body:{active:value.active,version:value.version,description:value.description,photos:value.photos.map(({postId,mediaId})=>({postId,mediaId}))}})
