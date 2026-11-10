import { WEATHER_EVIDENCE } from './demoWeather';
// Illustrative spatial deviations; these are not sensor measurements or model output.
export const rainBase=(hour:number)=>WEATHER_EVIDENCE.find(p=>p.hour===hour)?.rainMm??0;
export function rainAt(x:number,z:number,hour:number){const base=rainBase(hour);if(base===0)return 0;const deviation=.075*(.6*Math.sin(x*.026+z*.014+(hour-6)*.22)+.4*Math.cos(z*.045-x*.011-(hour-6)*.15));return Math.max(0,base+deviation*Math.min(1,base/.1));}
export const rainDomain=(hour:number)=>{const base=rainBase(hour);return {min:Math.max(0,base-.1),max:base+.1,base};};
