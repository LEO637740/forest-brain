import * as THREE from 'three/webgpu';

/** Runtime derivative only: base pixels unchanged, mip alpha calibrated to the actual cutout. */
export function trialMipCoverage(source:THREE.Texture,cutoff=.48){
  const image=source.image as HTMLCanvasElement;
  const read=(image:CanvasImageSource & {width:number;height:number})=>{
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
    return {canvas,ctx,pixels:ctx.getImageData(0,0,canvas.width,canvas.height)};
  };
  const coverage=(data:Uint8ClampedArray,scale=1)=>{
    let n=0;for(let i=3;i<data.length;i+=4)if(Math.min(255,Math.round(data[i]*scale))/255>=cutoff)n++;
    return n/(data.length/4);
  };
  const base=read(image),target=coverage(base.pixels.data),mips=[base.canvas];
  const stats:{width:number;oldCoverage:number;newCoverage:number;scale:number}[]=[];
  for(let level=1,w=Math.max(1,image.width>>1),h=Math.max(1,image.height>>1);;level++,w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h);
    let lo=0,hi=8;
    for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(coverage(pixels.data,mid)<target)lo=mid;else hi=mid;}
    const scale=Math.abs(coverage(pixels.data,lo)-target)<=Math.abs(coverage(pixels.data,hi)-target)?lo:hi;
    for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=232;pixels.data[i+3]=Math.min(255,Math.round(pixels.data[i+3]*scale));}
    ctx.putImageData(pixels,0,0);mips.push(canvas);
    const old=source.mipmaps[level] as unknown as HTMLCanvasElement|undefined;
    stats.push({width:w,oldCoverage:old?coverage(read(old).pixels.data):0,newCoverage:coverage(pixels.data),scale});
    if(w===1&&h===1)break;
  }
  const texture=source.clone();texture.source=new THREE.TextureSource(base.canvas);texture.mipmaps=mips;texture.generateMipmaps=false;texture.needsUpdate=true;
  return {texture,stats,target,cutoff};
}
