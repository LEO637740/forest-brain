import type {Task} from './model';
import {isCalendarDay,timeToMinutes} from './operationsModel.ts';

export type ExecutionWindow={notBefore?:number;notAfter?:number};

/** Task dates are business dates in China; legacy undated tasks retain their existing flow. */
export function taskExecutionWindow(task:Pick<Task,'kind'|'date'|'start'|'end'|'sourceParkPlanId'>):ExecutionWindow {
 if(task.kind!=='割胶'||!isCalendarDay(task.date))return {};
 const start=timeToMinutes(task.start),end=timeToMinutes(task.end);
 const day=Date.parse(`${task.date}T00:00:00+08:00`);
 const notBefore=day+(Number.isFinite(start)?start:0)*60000;
 return {notBefore,...(task.sourceParkPlanId&&Number.isFinite(start)&&Number.isFinite(end)&&end>start?{notAfter:day+end*60000}:{})};
}

export function executionWindowBlock(window:ExecutionWindow|undefined,now=Date.now()):string|undefined {
 if(window?.notBefore!==undefined&&now<window.notBefore)return `尚未到任务计划开始时间（${new Date(window.notBefore).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}），不能提前执行`;
 if(window?.notAfter!==undefined&&now>=window.notAfter)return '任务计划作业窗口已结束，请重新测算并安排时间';
}

export function taskExecutionBlock(task:Pick<Task,'kind'|'date'|'start'|'end'|'sourceParkPlanId'>,now=Date.now()):string|undefined {
 return executionWindowBlock(taskExecutionWindow(task),now);
}

/** A fresh weather answer may narrow, but cannot extend, an adopted task's schedule. */
export function mergeExecutionWindow<T extends ExecutionWindow>(timing:T,window?:ExecutionWindow):T&ExecutionWindow {
 const starts=[timing.notBefore,window?.notBefore].filter((value):value is number=>value!==undefined);
 const ends=[timing.notAfter,window?.notAfter].filter((value):value is number=>value!==undefined);
 return {...timing,notBefore:starts.length?Math.max(...starts):undefined,notAfter:ends.length?Math.min(...ends):undefined};
}
