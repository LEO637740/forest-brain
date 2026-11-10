import {parks} from '../../../shared/parkCatalog.ts';
import {makeDemoTaskReceipt} from '../../../shared/demoTaskChain.ts';

const templates = [
  {block:'A',title:'A区常规割胶',start:'08:00',end:'09:00',count:30,done:0,status:'待开始',phase:'scheduled'},
  {block:'B',title:'B区晨间割胶',start:'06:30',end:'08:00',count:36,done:12,status:'执行中',phase:'running'},
  {block:'C',title:'C区树表异常待处理',start:'07:00',end:'08:30',count:28,done:8,status:'待处理',phase:'review'},
  {block:'D',title:'D区割胶已完成',start:'05:00',end:'06:15',count:32,done:32,status:'已完成',phase:'completed'},
];

export function isBuiltInDemoTask(task) {
  return Boolean(parks[task.site] && /^\d{4}-\d{2}-\d{2}$/.test(task.date)
    && /^[ABCD]$/.test(task.block) && task.id === `demo-task-${task.date}-${task.site}-${task.block}`);
}

/** Keep task parameters as a snapshot; individual adopted angles override the zone default. */
export function makeDemoTaskChain(task, now = new Date(), adoptedAngles = []) {
  const park = parks[task.site], zone = 'ABCD'.indexOf(task.block);
  const time = task.dispatch?.history[0]?.time ?? now.toISOString();
  const adopted = !['waiting','scheduled'].includes(task.dispatch?.phase);
  const angleDeg = 28 + (park.offset + zone) % 5;
  const strategy = task.demoStrategy ?? {
    strategyId:`demo-strategy-${task.id.startsWith('demo-task-')?task.id.slice('demo-task-'.length):task.id}`, taskId:task.id, siteId:park.siteId,
    revision:1, mode:'simulation', generator:'demo_rules', generatedAt:time,
    adoptedAt:adopted?time:null, adoptedBy:adopted?'模拟园区管理员':null,
    title:`${park.name} · ${task.block}区${park.regionId?'割胶方案':'机器人试割方案（不计产量）'}`,
    summary:adoptedAngles.length
      ? `${task.block}区 ${task.count} 棵中，${adoptedAngles.length} 棵按已采用的单树角度${adoptedAngles.length<task.count?`，其余按 ${angleDeg}° 分区角度`:''}执行；切深 1.2 mm、速度 5 mm/s，树表异常暂停处理。`
      : `${task.block}区 ${task.count} 棵按 ${angleDeg}° 坡角、1.2 mm 切深、5 mm/s 速度依次模拟割胶；树表异常暂停并选择避让或跳过。`,
    basis:[`任务范围：${park.name} ${task.block}区 ${task.count} 棵`,
      `示例参数按园区与分区固定生成：坡角 ${angleDeg}°、切深 1.2 mm、速度 5 mm/s`,
      adoptedAngles.length?'单树角度取自创建任务时已采用的策略，保留各树来源和版本；未单独采用的树使用分区示例参数'
        :'用于策略、任务和回传联动演示，未读取现场测量或调用在线模型'],
    treeIndices:[...task.treeIndices], parameters:{angleDeg,cutDepthMm:1.2,speedMmPerSec:5},
    ...(adoptedAngles.length?{adoptedAngles}:{}),
    surfaceAction:'遇树表隆起暂停当前树；确认后采用避让路线继续，或跳过并保留复查记录',
  };
  const receipts = [...(task.demoReceipts ?? [])];
  const recorded = new Set(receipts.map(receipt => receipt.treeIndex));
  const skipped = task.dispatch?.skipped ?? [];
  const processed = task.treeIndices.slice(0,task.done + skipped.length);
  const finishedAt = task.dispatch?.history.at(-1)?.time ?? time;
  for (const index of processed) {
    if (recorded.has(index)) continue;
    const outcome = skipped.includes(index)?'skipped':'completed';
    receipts.push(makeDemoTaskReceipt(strategy,index,outcome,finishedAt,
      outcome==='skipped'?'模拟回传：已跳过该树，保留复查记录':'模拟回传：已按关联方案完成割胶'));
  }
  return {...task,demoStrategy:strategy,demoReceipts:receipts};
}

/** Newly adopted production tasks use the same simulated execution and receipts as daily samples. */
export function preparePlannedTask(task, now = new Date(), adoptedAngles = []) {
  const [hours,minutes]=task.start.split(':').map(Number);
  const endMinutes=Math.min(1439,hours*60+minutes+Math.max(15,task.count*2));
  const scheduled={...task,end:task.end==='—'?`${String(Math.floor(endMinutes/60)).padStart(2,'0')}:${String(endMinutes%60).padStart(2,'0')}`:task.end};
  if(task.site==='hainan')return scheduled;
  return makeDemoTaskChain({...scheduled,dispatch:{phase:'scheduled',requestId:task.id,
    history:[{time:now.toISOString(),label:'生产方案已采用，等待开始模拟作业'}]}},now,adoptedAngles);
}

/** Daily demonstration snapshots; automatic playback begins only when requested. */
export function makeDemoTasks(now = new Date()) {
  const date = new Date(+now + 8*3600000).toISOString().slice(0,10);
  const time = now.toISOString();
  return Object.values(parks).flatMap(park => templates.map((template,zone) => {
    const {phase,...production} = template;
    // The trial station tests robots; its samples must not read as production tapping.
    const plan = park.regionId ? production : {...production,title:`${production.block}区机器人试割（不计产量）`};
    const id = `demo-task-${date}-${park.key}-${plan.block}`;
    const treeIndices = Array.from({length:plan.count},(_,index) => zone*50+index);
    const history = [{time,label:'创建当日模拟作业样例'}];
    if(plan.done)history.push({time,label:`模拟完成 ${plan.done}/${plan.count} 棵`});
    history.push({time,label:phase==='review'?'模拟检查发现树表隆起，等待处理':phase==='completed'?'本次模拟作业已完成':phase==='running'?'模拟执行中，等待继续演示':'已接收模拟计划，等待开始演示'});
    return makeDemoTaskChain({...plan,id,site:park.key,siteId:park.siteId,date,title:`模拟 · ${plan.title}`,robot:`${park.treePrefix}-模拟机器人-${plan.block}`,kind:'割胶',treeIndices,
      dispatch:{phase,requestId:id,history,...(phase==='review'?{incident:{treeIndex:treeIndices[plan.done],detectedAt:time,lastCaptureAt:time,status:'review',category:'结构隆起',captures:1}}:{})}},now);
  }));
}

export const RETIRED_SAMPLE_REASON = '往日演示样例：当天未继续演示或处理，已自动结束；已有模拟回传保留';
const OPEN_STATUSES = new Set(['待开始','执行中','待处理']);

/** A past daily sample nobody played or handled: its seeded state and history, no playback and no rail dispatch. */
export function isUntouchedPastSample(task, today) {
  const history = task.dispatch?.history ?? [];
  const seeded = isBuiltInDemoTask(task) && templates.find(template => template.block === task.block);
  return Boolean(seeded) && task.date < today && OPEN_STATUSES.has(task.status)
    && task.status === seeded.status && task.done === seeded.done
    && history.length > 0 && history.every(entry => entry.time === history[0].time)
    && !task.dispatch.auto && !task.railBatch && !task.railResult;
}

export function seedDemoTasks(simulation, now = new Date()) {
  const current = simulation.latestTasks();
  const existing = new Set(current.map(task => task.id));
  const tasks = makeDemoTasks(now).filter(task => !existing.has(task.id));
  const enriched = simulation.enrichDemoTaskChains(current.filter(isBuiltInDemoTask).map(task=>makeDemoTaskChain(task,now)));
  // Each day brings fresh samples; yesterday's untouched ones would otherwise stay
  // "running" or "pending" forever and crowd today's decisions. Played or handled
  // samples, completed ones and real plan tasks are left exactly as they are.
  const today = new Date(+now + 8*3600000).toISOString().slice(0,10), time = now.toISOString();
  const retired = simulation.latestTasks().filter(task => isUntouchedPastSample(task, today)).map(task => ({...task, status:'已取消',
    cancelReason:RETIRED_SAMPLE_REASON, dispatch:{...task.dispatch, phase:'cancelled', history:[...task.dispatch.history, {time, label:RETIRED_SAMPLE_REASON}]}}));
  if (retired.length) simulation.tasks({tasks:retired});
  return enriched + (tasks.length?simulation.tasks({tasks}).accepted:0);
}
