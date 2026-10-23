'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DistrictGeoJSON } from '@/lib/types'

/**
 * "Which council district do I live in?", answered once and remembered.
 *
 * The address -> district lookup existed twice (council page, bill page's
 * Contact button), each with its own copy of the geocode + point-in-polygon
 * code. This is the shared version, and it also remembers the answer so the
 * home page can open on "your district" instead of a generic list.
 *
 * Privacy: the address goes to OpenStreetMap's geocoder (Nominatim) and is
 * otherwise kept only in this browser's localStorage. Nothing is sent to our
 * server except the public district-boundaries request.
 */

const KEY = 'cg_my_district'
const LEGACY_ADDRESS_KEY = 'cg_user_address'   // read by the bill page's Contact button

export interface MyDistrict {
  address: string
  district: number
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function districtAt(lat: number, lng: number, geojson: DistrictGeoJSON): number | null {
  for (const f of geojson.features ?? []) {
    const p = (f?.properties ?? {}) as Record<string, unknown>
    const num = Number(p.DISTRICT ?? p.District ?? p.district ?? p.DIST_NUM ?? p.districtNum ?? NaN)
    if (Number.isNaN(num)) continue
    const g = f.geometry
    const rings: number[][][] =
      g?.type === 'Polygon' ? [(g.coordinates as number[][][])[0]]
      : g?.type === 'MultiPolygon' ? (g.coordinates as number[][][][]).map((c) => c[0])
      : []
    if (rings.some((r) => pointInRing(lat, lng, r))) return num
  }
  return null
}

/** Resolve an address to a district number, or a reader-facing error string. */
export async function lookupDistrict(address: string): Promise<number | string> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 8000)
  try {
    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${address}, Philadelphia, PA`)}&format=json&limit=1`,
      { signal: abort.signal },
    ).then((r) => r.json())
    if (!geo?.length) return 'We could not find that address. Try a street number and street name.'
    const geojson: DistrictGeoJSON = await fetch('/api/councilmembers/districts-geojson').then((r) => r.json())
    const num = districtAt(parseFloat(geo[0].lat), parseFloat(geo[0].lon), geojson)
    return num ?? 'That address does not fall inside a Philadelphia council district.'
  } catch {
    return 'The address lookup is not responding right now. Please try again.'
  } finally {
    clearTimeout(timer)
  }
}

function read(): MyDistrict | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as MyDistrict) : null
  } catch {
    return null
  }
}

export function useMyDistrict() {
  // null until mounted, so server and first client render agree.
  const [mine, setMine] = useState<MyDistrict | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setMine(read())
    setReady(true)
    // Another tab (or the bill page) changing it should show up here too.
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setMine(read()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback((value: MyDistrict) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(value))
      localStorage.setItem(LEGACY_ADDRESS_KEY, value.address)
    } catch { /* storage blocked: still works for this visit */ }
    setMine(value)
  }, [])

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
      localStorage.removeItem(LEGACY_ADDRESS_KEY)
    } catch { /* ignore */ }
    setMine(null)
  }, [])

  return { mine, ready, save, clear }
}
