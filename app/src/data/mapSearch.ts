import type { ApiPlaceListItem } from '../api/client'
import type { MapHandle } from '../native/mapApi'

/** Shared eligibility for map markers and map search, independent of post count. */
export function isMappablePlace(place: ApiPlaceListItem): boolean {
  return place.enabled !== false && typeof place.latitude === 'number' && Number.isFinite(place.latitude)
    && place.latitude >= -90 && place.latitude <= 90
    && typeof place.longitude === 'number' && Number.isFinite(place.longitude)
    && place.longitude >= -180 && place.longitude <= 180
}

/** Search the same loaded places as the map, restricted to its current geographic viewport.
 * Do not use decluttering/zoom visibility: overlapping or temporarily collapsed pins remain searchable.
 */
export function mapSearchPlaces(places: ApiPlaceListItem[], handle: MapHandle, keyword: string): ApiPlaceListItem[] {
  const size = handle.getSize()
  if (!size || size.width <= 0 || size.height <= 0) return []
  const query = keyword.trim().toLocaleLowerCase('zh-CN')
  return places.filter(place => {
    if (!isMappablePlace(place)) return false
    const point = handle.project(place.latitude!, place.longitude!)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height) return false
    return !query || `${place.name}\n${place.address ?? ''}`.toLocaleLowerCase('zh-CN').includes(query)
  })
}
