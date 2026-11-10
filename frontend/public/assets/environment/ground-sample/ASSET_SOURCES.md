# Local ground sample material, 2026-09-21

Only this opt-in sample loads the new material. No frozen tree or Asset Factory files were changed.

| Asset | Source / author | License | Use |
|---|---|---|---|
| Grass Path 2 | https://polyhaven.com/a/grass_path_2 / Rob Tuytel | CC0: https://polyhaven.com/license | Sparse grass and exposed soil transition in the bounded test patch, 1 metre texture repeat, 1K maps |

This is a generic scanned surface, not site-specific Hainan survey data or a botanically certified rubber-plantation surface.

| File | Bytes | MD5 |
|---|---:|---|
| grass_path_Diffuse.jpg | 716010 | 48cebe95af233211c9469a9bfe2f42f2 |
| grass_path_nor_gl.jpg | 831959 | aa04d930b6af2bd7e3252e31776822bd |
| grass_path_Rough.jpg | 335245 | a3f245c716d0f2bbdece65a38b1bcd4a |

Total 1,883,214 bytes. Original files downloaded from Poly Haven, not preview images:

- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/grass_path_2/grass_path_2_diff_1k.jpg
- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/grass_path_2/grass_path_2_nor_gl_1k.jpg
- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/grass_path_2/grass_path_2_rough_1k.jpg

The sample reuses Forest Floor and Gravel Ground 01 (their source manifests remain in phase-a and vc-a). Brown Mud remains in the unchanged scene outside the sample. No plant geometry, heightmap, HDRI or Blender asset was downloaded/generated.

Runtime adjustments: matched UVs for all PBR channels; stochastic translated samples; modest albedo saturation/tint; wetness-related darkening/roughness; geometric metre-scale relief. Material blending is mask-based, not scanned height-map blending. Geometry is an artistic demonstration, not measured terrain.
