/** Visual inspection samples, NOT an approved cutting path or semantic segmentation.
 * Root-local meters, sampled from the unchanged Mature B LOD0 mesh in side view.
 * SHA256 B6A37A765E76557D2D5637CAA235D1F7E48E0C5C184E9527DABCFF7E0EE1EC65
 * Evidence: output/playwright/rail-sample/anchor-source.png, 1920x1080.
 * Do not reuse for a different family/LOD/generated variant without recalibration.
 */
export const railTreeAnchors = [
  {id:'panel-surface-sample',label:'割面采样点',color:'#ffca68',pixel:[1080,578],local:[.0846424041,1.3937904328,.2592819663]},
  {id:'cup-rim-sample',label:'胶杯口采样点',color:'#62dff5',pixel:[1080,787],local:[.2568947440,.8040857725,.2761864368]},
] as const;
export const r3TcpHeightRange = {min:1.67,max:1.79} as const;
