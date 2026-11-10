export type WindowRect={left:number;top:number;width:number;height:number};
export type WindowViewport={width:number;height:number;top:number};
export function fitWindow(rect:WindowRect,v:WindowViewport):WindowRect{
 const top=Math.min(v.top,Math.max(8,v.height-120));
 const width=Math.max(1,Math.min(rect.width,v.width-16));
 const height=Math.max(1,Math.min(rect.height,v.height-top-8));
 return {width,height,left:Math.max(8,Math.min(rect.left,v.width-width-8)),top:Math.max(top,Math.min(rect.top,v.height-height-8))};
}
export function initialWindow(v:WindowViewport,order=0):WindowRect{
 const width=Math.min(1060,Math.max(320,v.width-120));
 const height=Math.min(v.height*.72,v.height-v.top-88);
 const offset=(order%5)*28;
 return fitWindow({width,height,left:(v.width-width)/2+offset,top:v.top+16+offset},v);
}
