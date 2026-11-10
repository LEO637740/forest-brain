# VC-A：新增公共素材

日期：2026-09-21。只新增一套细砂砾道路 PBR；没有新增树、灌木、石块模型或 HDRI，也没有操作 Blender / Asset Factory。

| 素材 | 来源与作者 | 授权 | 使用位置 | 尺度 |
|---|---|---|---|---|
| Gravel Ground 01 | [Poly Haven](https://polyhaven.com/a/gravel_ground_01)，Rob Tuytel | [CC0](https://polyhaven.com/license)，允许商业使用与随项目分发 | 压实细砂砾主路、支路与路肩 | 3 m / 平铺周期，1K |

下载的是原始贴图文件，不是网页预览图；使用官方 files API 与 dl.polyhaven.org。

| 本地文件 | 通道 / 色彩空间 | 字节 | MD5 |
|---|---|---:|---|
| gravel_Diffuse.jpg | Albedo / sRGB | 954257 | ee99ef89fb50cfeb198db369bb7151f0 |
| gravel_nor_gl.jpg | OpenGL Normal / linear | 1314248 | 8a54072ce38665da29081d57dc10cb69 |
| gravel_Rough.jpg | Roughness / linear | 379669 | 65bfe11a3fa71c9ac3f07ca09a4dbd88 |

总下载量 2,648,174 字节（约 2.65 MB）。URL：

- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel_ground_01/gravel_ground_01_diff_1k.jpg
- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel_ground_01/gravel_ground_01_nor_gl_1k.jpg
- https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel_ground_01/gravel_ground_01_rough_1k.jpg

沿用 phase-a 中 Forest Floor（eye-candy.xyz）和 Brown Mud（Rob Tuytel），来源和校验见该目录的 ASSET_SOURCES.md。本轮总计仍为三套地表材质；Forest Floor 用于林下与沟壁、Brown Mud 用于湿润沟底。通用落叶不作为橡胶叶的植物学证据。

颜色、粗糙度、纹理混合、叶片 atlas/mipmap 与光照校准均发生在前端运行时。所有冻结 GLB 不变。
