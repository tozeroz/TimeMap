// Real geolocation check. Precondition: location permission already granted
//   adb shell pm grant com.campusx.demo android.permission.ACCESS_FINE_LOCATION
// Keys are ASCII so acceptance.ps1 can match them without encoding trouble.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = '#/campus'
  await wait(700)
  location.hash = '#/map'
  await wait(1500)
  // close the "authorize location" dialog (first button = not now)
  document.querySelector('.map__modal-btn')?.click()
  await wait(8000)

  const badge = document.querySelector('.map__geoBadge')
  const here = document.querySelector('.rm__here')
  const host = document.querySelector('.realmaps')
  const acc = Number(here?.dataset.acc ?? NaN)
  const lat = Number(here?.dataset.lat ?? NaN)
  const lng = Number(here?.dataset.lng ?? NaN)

  // tap "back to my location": the map should fly so the blue dot lands centered
  const before = here?.getBoundingClientRect() ?? null
  const hostRect = host?.getBoundingClientRect() ?? null
  document.querySelectorAll('.map__ctrl')[0]?.click()
  await wait(1800)
  const after = document.querySelector('.rm__here')?.getBoundingClientRect() ?? null
  const drift =
    after && hostRect
      ? Math.round(
          Math.hypot(
            after.left + after.width / 2 - (hostRect.left + hostRect.width / 2),
            after.top + after.height / 2 - (hostRect.top + hostRect.height / 2),
          ),
        )
      : null
  const beforeDrift =
    before && hostRect
      ? Math.round(
          Math.hypot(
            before.left + before.width / 2 - (hostRect.left + hostRect.width / 2),
            before.top + before.height / 2 - (hostRect.top + hostRect.height / 2),
          ),
        )
      : null

  return {
    badge: badge?.innerText ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    accuracy: Number.isFinite(acc) ? acc : null,
    realFix: here?.dataset.real === '1',
    hereDots: document.querySelectorAll('.rm__here').length,
    accuracyCircles: document.querySelectorAll('.leaflet-overlay-pane path').length,
    onlineTiles: document.querySelectorAll('.leaflet-tile-loaded').length,
    farHint: document.querySelector('.map__geoFar')?.innerText ?? null,
    coordValid: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
    accuracyValid: Number.isFinite(acc) && acc > 0,
    notCampusFallback: Number.isFinite(lat) && !(Math.abs(lat - 39.9503) < 1e-6 && Math.abs(lng - 116.3396) < 1e-6),
    dotVisible: !!before && before.width > 0,
    driftBefore: beforeDrift,
    driftAfter: drift,
    recenterOk: drift !== null && drift < 40,
  }
})()
