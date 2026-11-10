import {invariant} from './errors.js';
const day=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
export function ledgerSeries(batches,{startDate,endDate,now=new Date()}){
 const end=endDate??day(now.toISOString()),start=startDate??new Date(Date.parse(end+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 for(const date of [start,end])invariant(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'INVALID_DATE','日期须为有效的YYYY-MM-DD。');
 const days=(Date.parse(end)-Date.parse(start))/86400000+1;
 invariant(days>=1&&days<=90,'INVALID_DATE_RANGE','查询时间范围须为1至90天。');
 const rows=Array.from({length:days},(_,i)=>({date:new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),latexKg:null,dryKg:null,batchIds:[]}));
 for(const batch of batches.filter(b=>b.stage!=='cancelled'))for(const [record,key,value] of [[batch.weighing,'latexKg',batch.weighing?.netKg],[batch.processing,'dryKg',batch.processing?.dryKg]]){
  if(!record?.at||!Number.isFinite(value))continue;
  const row=rows.find(r=>r.date===day(record.at));if(!row)continue;
  row[key]=Math.round(((row[key]??0)+value)*1000)/1000;
  if(!row.batchIds.includes(batch.id))row.batchIds.push(batch.id);
 }
 return {title:'收胶与加工记录',startDate:start,endDate:end,rows,unit:'kg',note:'按北京时间统计：鲜胶乳按称重日期、干胶按加工日期。空白表示没有登记记录，不代表实际产量为零；两种重量不能相加。',sourceRefs:[...new Set(rows.flatMap(r=>r.batchIds))]};
}
