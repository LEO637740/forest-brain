import {PLANT_SPACING_M, ROW_SPACING_M} from '../../shared/demoSpatial.ts';
export {PLANT_SPACING_M, ROW_SPACING_M};

// Rails run 1.25 m beside each tree row (zoneFleet.ts) and the follow target is the robot body,
// 1.2 m above its rail position. The camera stands in the middle of the inter-row alley at about
// eye height, below crowns that start near 3.2–4.3 m on these trees, 6 m back along the row.
export const ALLEY_CAMERA_OFFSET = {x:6, y:-0.2, z:ROW_SPACING_M / 2 - 1.25} as const;

// The 200 managed trees of the demo garden in scene metres: four zones, each with five
// rows of ten trees planted 3 m apart in the row and 7 m between rows, the conventional
// rubber spacing also used for the 2D map. Rows follow the slope slightly and keep a
// small planting jitter. The seeded draw order (x, z, family, scale, yaw) is unchanged,
// so every tree keeps its model family and orientation from the earlier layout.
export const SCENE_ZONE_CENTERS = [{x:-76,z:-32},{x:-15,z:-30},{x:42,z:28},{x:91,z:-12}] as const;
export type SceneFamily = 'A' | 'B' | 'C';
export type SceneTree = {x:number;z:number;zone:number;index:number;archetype:SceneFamily;scale:number;rotation:number};

export function sceneTreeLayout(seed = 20260918): SceneTree[] {
  let state = seed;
  const random = () => {state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296;};
  return SCENE_ZONE_CENTERS.flatMap((center, zone) => Array.from({length:50}, (_, offset) => {
    const row = Math.floor(offset / 10), column = offset % 10;
    const x = center.x + (column - 4.5) * PLANT_SPACING_M + (row % 2) * 0.6 + (random() - 0.5) * 0.5;
    const z = center.z + (row - 2) * ROW_SPACING_M + Math.sin(column * 0.6) * 0.8 + (random() - 0.5) * 0.5;
    const pick = random(), archetype: SceneFamily = pick < 0.3 ? 'A' : pick < 0.8 ? 'B' : 'C';
    return {x, z, zone, index:zone * 50 + offset, archetype, scale:0.9 + random() * 0.16, rotation:random() * Math.PI * 2};
  }));
}

/** Axis-aligned zone footprint around its trees, with half a row of margin. */
export function sceneZoneBox(trees: readonly {x:number;z:number}[], zone: number) {
  const group = trees.slice(zone * 50, zone * 50 + 50);
  const xs = group.map(tree => tree.x), zs = group.map(tree => tree.z);
  const margin = ROW_SPACING_M / 2;
  const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin, z0 = Math.min(...zs) - margin, z1 = Math.max(...zs) + margin;
  return {x:(x0 + x1) / 2, z:(z0 + z1) / 2, w:x1 - x0, d:z1 - z0};
}

/** Planted area of the 200 managed trees at this spacing, in mu (1 mu = 666.67 m²). */
export const SCENE_PLANTED_MU = 200 * PLANT_SPACING_M * ROW_SPACING_M / 666.67;

// Model dimensions measured from each LOD0 asset: crown top including leaves, and stem girth
// at 1.3 m (breast height). Used to size every managed tree from its own record.
export const TREE_MODEL_DIMENSIONS: Record<SceneFamily | 'V20', {heightM:number;girthCm:number}> = {
  A:{heightM:13.9, girthCm:69}, B:{heightM:13.6, girthCm:77}, C:{heightM:13.8, girthCm:66}, V20:{heightM:13.0, girthCm:89},
};
export type TreeProfile = {heightM:number | null; circumferenceCm:number | null} | null | undefined;

/**
 * Height scales the model vertically and girth scales the stem and crown horizontally.
 * Trees without a measurement keep the seeded presentation scale. The horizontal/vertical
 * ratio is bounded so a sparse or erroneous record cannot produce a distorted tree.
 */
export function treeScale(profile: TreeProfile, family: SceneFamily | 'V20', fallback: number) {
  const model = TREE_MODEL_DIMENSIONS[family];
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const height = profile?.heightM, girth = profile?.circumferenceCm;
  const vertical = height != null && height > 0 ? clamp(height / model.heightM, 0.45, 1.5) : fallback;
  const horizontal = girth != null && girth > 0 ? clamp(girth / model.girthCm, 0.45, 1.5) : vertical;
  return {x:clamp(horizontal, vertical * 0.75, vertical * 1.33), y:vertical};
}
