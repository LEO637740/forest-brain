import { invariant } from '../errors.js';

export const cleanText = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export function articleMeta(html) {
  const meta = name => [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => Object.fromEntries([...m[0].matchAll(/([\w-]+)=["']([^"']*)["']/g)].map(a=>[a[1].toLowerCase(),a[2]]))).find(x=>x.name?.toLowerCase()===name.toLowerCase())?.content;
  const title = meta('ArticleTitle') ?? cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]??'').split(' -- ')[0];
  const date=meta('PubDate');
  invariant(title && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(date??''),'INVALID_PUBLIC_DATA','官方文献标题或发布日期缺失',502);
  return {title,publishedAt:date.replace(' ','T')+(date.length===16?':00':'')+'+08:00',publisher:meta('ContentSource')??'官方公开资料'};
}
export function articleBody(html) {
  // These official sites put their article in a TRS editor container. Read its
  // balanced div subtree so related-story links and navigation cannot be facts.
  const tags=[...html.matchAll(/<\/?div\b[^>]*>/gi)];
  const start=tags.findIndex(m=>!/^<\//.test(m[0])&&/\bclass\s*=\s*(?:["'][^"']*\b(?:TRS_Editor|TRS_UEDITOR)\b|(?:TRS_Editor|TRS_UEDITOR)\b)/i.test(m[0]));
  if(start<0)return html; // Small text-only fixtures or a page without a TRS wrapper.
  let depth=0;
  for(let i=start;i<tags.length;i++) {
    depth+=/^<\//.test(tags[i][0])?-1:1;
    if(!depth)return html.slice(tags[start].index+tags[start][0].length,tags[i].index);
  }
  invariant(false,'INVALID_PUBLIC_DATA','官方正文容器不完整',502);
}
export function articleParagraphs(html,{fullArticle=false}={}) {
  const paragraphs=[...articleBody(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>cleanText(m[1])).filter(t=>t&&(fullArticle||t.length>20&&/橡胶|胶乳|胶价|胶园|割胶|白粉病|小蠹虫|叶螨|胶树/.test(t)));
  invariant(paragraphs.length<=100,'INVALID_PUBLIC_DATA','官方正文长度超出预期，需复核提取范围',502);
  return paragraphs;
}
export function discoverReport(html, type, now) {
  const pattern=type==='monthly_report'?/^\d{4}年\d{1,2}月天然橡胶市场动态$/:/橡胶树.*(病|虫|防治|风险)/;
  const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{
    const title=cleanText(m[2]).replace(/\s*\d{4}-\d{2}-\d{2}$/,''); if(!pattern.test(title))return[];
    const url=new URL(m[1],'https://nkj.moa.gov.cn/rzny/');
    const date=url.pathname.match(/\/t(\d{4})(\d{2})(\d{2})_\d+\.htm$/);
    if(url.origin!=='https://nkj.moa.gov.cn'||!url.pathname.startsWith('/rzny/')||!date)return[];
    const publishedDay=`${date[1]}-${date[2]}-${date[3]}`;
    if(Date.parse(publishedDay+'T00:00:00+08:00')>+now)return[];
    return [{url:url.href,title,publishedDay}];
  });
  links.sort((a,b)=>b.publishedDay.localeCompare(a.publishedDay));
  invariant(links.length,'INVALID_PUBLIC_DATA','官方目录未找到对应橡胶资料',502);
  return links[0];
}
export function normalizeReport(html,type,now) {
  const meta=articleMeta(html), text=cleanText(articleBody(html)).replaceAll(' ',''), paragraphs=articleParagraphs(html,{fullArticle:type!=='production_hainan'});
  invariant(Date.parse(meta.publishedAt)<=+now,'INVALID_PUBLIC_DATA','公告发布时间在未来',502);
  const metrics=[];
  const number='((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
  const metric=(name,regex,unit,scope,period)=>{ const m=text.match(regex); if(m)metrics.push({name,value:Number(m[1].replaceAll(',','')),unit,scope,period}); };
  let period,scope;
  if(type==='monthly_report') {
    const m=meta.title.match(/^(\d{4})年(\d{1,2})月天然橡胶市场动态$/);
    invariant(m&&+m[2]>=1&&+m[2]<=12,'INVALID_PUBLIC_DATA','月报标题不匹配',502); period=`${m[1]}-${m[2].padStart(2,'0')}`;scope='国内外天然橡胶市场';
    invariant(period<meta.publishedAt.slice(0,7),'INVALID_PUBLIC_DATA','月报统计期尚未结束',502);
    metric('海南鲜胶乳折干胶月均价',new RegExp('海南鲜胶乳[（(]折干胶[）)]月均价格(?:为)?'+number+'元/吨'),'CNY/tonne_dry_rubber','海南产区监测点',period);
    metric('云南鲜胶乳折干胶月均价',new RegExp('云南鲜胶乳[（(]折干胶[）)]月均价格(?:为)?'+number+'元/吨'),'CNY/tonne_dry_rubber','云南产区监测点',period);
    const imp=text.match(new RegExp('(\\d{4})年(\\d{1,2})月我国进口天然橡胶[（(]折干胶[）)]'+number+'万吨'));
    if(imp) {
      const importPeriod=`${imp[1]}-${imp[2].padStart(2,'0')}`;
      invariant(+imp[2]>=1&&+imp[2]<=12&&importPeriod<=period,'INVALID_PUBLIC_DATA','进口统计期无效或晚于月报统计期',502);
      metrics.push({name:'天然橡胶进口量（折干胶）',value:Number(imp[3].replaceAll(',','')),unit:'万吨',scope:'中国',period:importPeriod});
    }
    invariant(paragraphs.length && metrics.length,'INVALID_PUBLIC_DATA','月报关键指标解析失败，未填入推测数值',502);
  } else if(type==='production_national') {
    const year=meta.title.match(/^(\d{4})年天然橡胶产量/)?.[1];invariant(year,'INVALID_PUBLIC_DATA','全国产量报告标题不匹配',502);period=year;scope='中国';
    invariant(period<meta.publishedAt.slice(0,4),'INVALID_PUBLIC_DATA','年度统计期尚未结束',502);
    metric('天然橡胶产量',new RegExp(period+'年(?:我国|全国|中国)天然橡胶产量(?:达|为)'+number+'万吨'),'万吨',scope,period);
    metric('天然橡胶进口量（折干）',new RegExp(period+'年(?:我国|全国|中国)进口天然橡胶[（(]折干[）)]'+number+'万吨'),'万吨',scope,period);
    invariant(metrics.some(x=>x.name==='天然橡胶产量'),'INVALID_PUBLIC_DATA','全国天然橡胶产量解析失败',502);
  } else if(type==='production_hainan') {
    const year=meta.title.match(/^(\d{4})年海南省/)?.[1];invariant(year,'INVALID_PUBLIC_DATA','海南统计公报标题不匹配',502);period=year;scope='海南省';
    invariant(period<meta.publishedAt.slice(0,4),'INVALID_PUBLIC_DATA','年度统计期尚未结束',502);
    metric('橡胶产量',new RegExp('橡胶产量'+number+'万吨'),'万吨',scope,period);
    invariant(metrics.length,'INVALID_PUBLIC_DATA','海南橡胶产量解析失败',502);
  } else {
    invariant(/橡胶树/.test(meta.title)&&paragraphs.length,'INVALID_PUBLIC_DATA','橡胶病虫害资料正文缺失',502);period=meta.publishedAt.slice(0,4);scope='全国橡胶产区，具体适用地区见正文';
  }
  return {...meta,period,scope,metrics,paragraphs,interpretation:'官方公开统计或指导资料，保留原统计期；区域月均价不是园区当日成交价，宏观风险不是单树诊断。'};
}
