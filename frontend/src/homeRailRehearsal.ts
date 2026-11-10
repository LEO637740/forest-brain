import type {Object3D} from 'three';

// Specific HN-A-0045 candidate reviewed in output/robot-rail-v1/home-pilot-review.
// Presentation-only timeline, not the frozen R4 driver's original fixture path.
const park=.0846424041, work=.09553044725071067, low=-.30761578667419553, reach=.5230479778898267;
const keys=[
  [0,park,0,0],[1,work,0,0],[3,work,.3,0],[5,work,.3,low],
  [7,work,reach,low],[8,work,reach,low],[10,work,.3,low],
  [12,work,.3,0],[14,work,0,0],[15,park,0,0],
] as const;
const phases=['定位','伸出','下降','接近','近点停留','退回','抬升','收拢','回到停靠位'];
export const HOME_REHEARSAL_DURATION=15;
export function sampleHomeRailRehearsal(seconds:number){
  if(!Number.isFinite(seconds))throw new RangeError('Finite timeline time required');
  const t=Math.max(0,Math.min(HOME_REHEARSAL_DURATION,seconds));
  let i=0;while(i<keys.length-2&&t>=keys[i+1][0])i++;
  const a=keys[i],b=keys[i+1],u=(t-a[0])/(b[0]-a[0]),v=u*u*(3-2*u);
  return {travelM:a[1]+(b[1]-a[1])*v,extension:a[2]+(b[2]-a[2])*v,
    sliderOffset:a[3]+(b[3]-a[3])*v,toolFeed:0,phase:t===15?'已回到停靠位':phases[i]};
}

export function mountHomeRailRehearsal(robot:Object3D,panel:HTMLElement,onChange:()=>void,onStart:()=>void){
  const arm=robot.getObjectByName('ARM_SLIDE'),slider=robot.getObjectByName('VERTICAL_SLIDER'),feed=robot.getObjectByName('TOOL_FEED');
  if(!arm||!slider||!feed)throw new Error('Missing homepage rehearsal motion nodes');
  let time=0,state:'idle'|'running'|'paused'|'complete'='idle',lastPhase='';
  let runId='',startedAt='';
  const task=document.createElement('div');task.style.cssText='font-size:16px;font-weight:600;margin-top:12px';task.textContent='单树接近演示';
  const steps=document.createElement('div');steps.style.cssText='font-size:14px;line-height:1.6;margin-top:8px';
  const result=document.createElement('button');result.textContent='查看本次预演结果';result.hidden=true;result.style.cssText='display:block;width:100%;margin-top:10px;padding:10px;border:1px solid #89ddba;border-radius:4px;background:#183b2f;color:#eef7f0;cursor:pointer;font:inherit';
  // Explicitly keep rehearsal receipts outside the business task store.
  let receipt:{id:string;treeId:string;startedAt:string;completedAt:string;durationSeconds:number}|null=null;
  result.onclick=()=>{if(receipt)window.dispatchEvent(new CustomEvent('home-rail-preview-result',{detail:receipt}));};
  const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;margin-top:12px';
  const play=document.createElement('button'),reset=document.createElement('button'),status=document.createElement('div');
  const progress=document.createElement('progress');progress.max=15;progress.value=0;progress.setAttribute('aria-label','机器人预演进度');progress.style.cssText='width:100%;height:6px;accent-color:#89ddba;margin-top:12px';
  for(const b of [play,reset])b.style.cssText='border:1px solid #648174;border-radius:4px;padding:8px 12px;cursor:pointer;font:inherit;background:#183b2f;color:#eef7f0';
  play.style.background='#89ddba';play.style.color='#10271f';reset.textContent='复位预演';
  status.style.cssText='margin-top:8px;line-height:1.5';status.setAttribute('role','status');
  function reflect(){
    play.textContent=state==='running'?'暂停预演':state==='paused'?'继续预演':state==='complete'?'再次预演':'开始非接触预演';
    panel.dataset.rehearsalState=state;
    status.textContent=state==='idle'?'15 秒 · 接近后自动收回':`${state==='paused'?'已暂停 · ':''}${sampleHomeRailRehearsal(time).phase}`;
    const phase=time<1?0:time<7?1:time<8?2:time<15?3:4;
    steps.textContent=['定位','接近','停留','收回'].map((label,i)=>`${i<phase?'✓':i===phase?'●':'○'} ${label}`).join('  ');
    result.hidden=state!=='complete';result.style.display=state==='complete'?'block':'none';
  }
  function apply(){const p=sampleHomeRailRehearsal(time);robot.position.x=p.travelM;arm!.position.z=-p.extension;slider!.position.y=.67+p.sliderOffset;feed!.position.z=0;robot.updateMatrixWorld(true);panel.dataset.rehearsalTime=time.toFixed(3);progress.value=time;onChange();if(p.phase!==lastPhase){lastPhase=p.phase;reflect();}}
  function start(){if(state==='running')return;runId=crypto.randomUUID();startedAt=new Date().toISOString();receipt=null;time=0;state='running';onStart();apply();reflect();}
  play.onclick=()=>{if(state==='running')state='paused';else if(state==='paused'){onStart();state='running';}else {start();return;}reflect();};
  reset.onclick=()=>{receipt=null;time=0;state='idle';apply();reflect();};
  const hide=()=>{if(document.hidden&&state==='running'){state='paused';reflect();}};
  document.addEventListener('visibilitychange',hide);row.append(play,reset);panel.append(task,steps,row,progress,status,result);apply();reflect();
  return {start,pause:()=>{if(state==='running'){state='paused';reflect();}},update:(dt:number)=>{if(state!=='running')return;time=Math.min(15,time+Math.max(0,Math.min(.1,dt)));apply();if(time===15){state='complete';receipt={id:runId,treeId:'HN-A-0045',startedAt,completedAt:new Date().toISOString(),durationSeconds:15};reflect();window.dispatchEvent(new CustomEvent('home-rail-preview-result',{detail:receipt}));}},dispose:()=>{document.removeEventListener('visibilitychange',hide);task.remove();steps.remove();row.remove();progress.remove();status.remove();result.remove();}};
}
