/** One bounded release profile. The old homepage remains available with
 * ?homeVisual=legacy; historical sample URLs keep their original flags.
 * These are visual settings, never business positions or surveyed heights.
 */
export const HOME_VISUAL_PROFILE = {
  bounds: { minX: -84, maxX: 78, minZ: -56, maxZ: 66 },
  terrainStep: .5,
  // Reuse only the accepted local ground-cover footprint, not a garden-wide scatter.
  coverBounds: { minX: -66, maxX: -10, minZ: -24, maxZ: 48 },
  coverSpacing: .55,
} as const;

export function useHomeVisualProfile(params: URLSearchParams) {
  return params.get("homeVisual") === "1" || (!params.has("sample") && params.get("homeVisual") !== "legacy");
}

/** Keep the accepted central-patch release available for A/B verification. */
export function useEnvironmentRelease(params: URLSearchParams) {
  return useHomeVisualProfile(params) && params.get("environmentVisual") !== "previous";
}

/** Whole-terrain release remains available without the new habitat/sky. */
export function useNaturalRelease(params: URLSearchParams) {
  return useEnvironmentRelease(params) && params.get("naturalVisual") !== "previous";
}
