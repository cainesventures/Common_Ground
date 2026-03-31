'use client'

import { useEffect, useRef, useState } from 'react'

interface MemberLabel {
  name: string
  district: string   // "District 2" or "At-Large"
}

interface Props {
  district: string            // "District 2", "At-Large", or "all"
  members?: MemberLabel[]     // When provided and district="all", labels each polygon
  height?: number
}

const PHILLY_CENTER: [number, number] = [39.9526, -75.1652]
const DISTRICTS_GEOJSON_URL = '/api/councilmembers/districts-geojson'

// Distinct muted colours for the full-city view — one per district (1–10)
const DISTRICT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]

function getDistrictNum(props: Record<string, any>): number | null {
  const val = props?.DISTRICT ?? props?.District ?? props?.district ??
              props?.DIST_NUM ?? props?.districtNum ?? props?.OBJECTID ?? null
  if (val === null || val === undefined) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

export function DistrictMap({ district, members = [], height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [fetchError, setFetchError] = useState(false)

  const showAll = district === 'all'
  const districtNum = showAll || district === 'At-Large'
    ? null
    : parseInt(district.replace(/\D/g, ''), 10)

  // Build a lookup: district number → member name (for the full-city view)
  const memberByDistrict: Record<number, string> = {}
  if (showAll && members.length > 0) {
    for (const m of members) {
      const n = parseInt(m.district.replace(/\D/g, ''), 10)
      if (!isNaN(n)) memberByDistrict[n] = m.name
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    let mounted = true
    setFetchError(false)

    import('leaflet').then((L) => {
      if (!mounted || !containerRef.current) return

      const container = containerRef.current as any
      if (container._leaflet_id) container._leaflet_id = undefined
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      if (!document.body.contains(containerRef.current)) return

      try { (containerRef.current as any)._leaflet_id = undefined } catch { /* ignore */ }
      const map = L.map(containerRef.current, {
        center: PHILLY_CENTER,
        zoom: 11,
        zoomControl: showAll,
        scrollWheelZoom: false,
        dragging: showAll,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      fetch(DISTRICTS_GEOJSON_URL)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((geojson) => {
          if (!mounted) return

          const layer = L.geoJSON(geojson, {
            style: (feature) => {
              const num = getDistrictNum(feature?.properties ?? {})
              if (showAll) {
                const color = num ? DISTRICT_COLORS[(num - 1) % DISTRICT_COLORS.length] : '#94a3b8'
                return { color, weight: 1.5, fillColor: color, fillOpacity: 0.25 }
              }
              const isTarget = districtNum !== null && num === districtNum
              return {
                color: isTarget ? '#2563eb' : '#94a3b8',
                weight: isTarget ? 2.5 : 1,
                fillColor: isTarget ? '#3b82f6' : '#cbd5e1',
                fillOpacity: isTarget ? 0.35 : 0.08,
              }
            },
            onEachFeature: (feature, lyr) => {
              const num = getDistrictNum(feature?.properties ?? {})
              if (showAll) {
                const memberName = num ? memberByDistrict[num] : null
                const label = memberName
                  ? `<strong>District ${num}</strong><br/>${memberName}`
                  : `District ${num ?? '?'}`
                lyr.bindTooltip(label, { sticky: true })
              } else {
                lyr.bindTooltip(num !== null ? `District ${num}` : 'District', { sticky: true })
              }
            },
          }).addTo(map)

          if (!showAll && districtNum !== null) {
            const targetLayers: any[] = []
            layer.eachLayer((lyr: any) => {
              if (getDistrictNum(lyr.feature?.properties ?? {}) === districtNum) targetLayers.push(lyr)
            })
            if (targetLayers.length > 0) {
              map.fitBounds(targetLayers[0].getBounds(), { padding: [32, 32] })
            }
          } else {
            map.fitBounds(layer.getBounds(), { padding: [16, 16] })
          }
        })
        .catch((err) => {
          console.warn('[DistrictMap] GeoJSON fetch failed:', err)
          if (mounted) setFetchError(true)
        })
    })

    return () => {
      mounted = false
      if (mapRef.current) {
        try { mapRef.current.remove() } catch { /* DOM already detached */ }
        mapRef.current = null
      }
    }
  }, [districtNum, showAll])

  const title = showAll
    ? 'Philadelphia City Council Districts'
    : district === 'At-Large' ? 'At-Large — Citywide' : `Philadelphia ${district}`

  return (
    <div style={{ isolation: 'isolate' }} className="border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <p className="text-sm font-medium">{title}</p>
      </div>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      {fetchError ? (
        <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
          Could not load district boundaries.
        </div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}
    </div>
  )
}
