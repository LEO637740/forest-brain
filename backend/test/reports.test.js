import test from 'node:test';
import assert from 'node:assert/strict';
import { articleParagraphs, discoverReport, normalizeReport } from '../src/adapters/public-reports.js';
const now=new Date('2026-10-01T08:00:00Z');
const article=(title,body)=>`<meta name="ArticleTitle" content="${title}"><meta name="PubDate" content="2026-09-11 09:23:00"><meta name="ContentSource" content="农垦局"><p>${body}</p>`;
test('official directory: latest matching report, ignore cross-origin and future links',()=>{
  const html='<a href="https://evil.example/rzny/202609/t20260920_123.htm">2026年9月天然橡胶市场动态</a><a href="./202609/t20260911_123.htm">2026年8月天然橡胶市场动态 2026-09-11</a><a href="./202610/t20261020_123.htm">2026年9月天然橡胶市场动态</a>';
  assert.equal(discoverReport(html,'monthly_report',now).url,'https://nkj.moa.gov.cn/rzny/202609/t20260911_123.htm');
  assert.throws(()=>discoverReport('<a href="https://evil.example/no">橡胶树病害防治</a>','pest_updates',now),e=>e.code==='INVALID_PUBLIC_DATA');
});
test('monthly report: price and import periods are separate; unknown indicators are not invented',()=>{
  const r=normalizeReport(article('2026年8月天然橡胶市场动态','海南鲜胶乳（折干胶）月均价格为16271元/吨。2026年7月我国进口天然橡胶（折干胶）19.14万吨。'),'monthly_report',now);
  assert.equal(r.metrics.length,2);assert.equal(r.metrics[0].period,'2026-08');assert.equal(r.metrics[1].period,'2026-07');assert.equal(r.metrics[1].unit,'万吨');
  assert.throws(()=>normalizeReport(article('2026年8月天然橡胶市场动态','没有可以解析的指标'),'monthly_report',now),e=>e.code==='INVALID_PUBLIC_DATA');
});
test('production reports: national/province scope and annual period cannot be collapsed',()=>{
  const national=normalizeReport(article('2025年天然橡胶产量达97.3万吨','2025年全国天然橡胶产量达97.3万吨；进口天然橡胶（折干）649.2万吨。'),'production_national',now);
  const province=normalizeReport(article('2025年海南省国民经济和社会发展统计公报','海南省2025年橡胶产量34.95万吨，比上年下降5.2%。'),'production_hainan',now);
  assert.equal(national.scope,'中国');assert.equal(province.scope,'海南省');assert.equal(province.period,'2025');assert.equal(province.metrics[0].value,34.95);
});
test('official article boundary excludes navigation/related prices and retains headings and caveats',()=>{
  const html=article('2026年8月天然橡胶市场动态','网页导航：海南鲜胶乳（折干胶）月均价格为99999元/吨。')+
    '<div class="TRS_Editor"><div><p>国内主销区：全乳胶均价处于高位。</p><p>海南鲜胶乳（折干胶）月均价格为16,271元/吨。</p></div><p>备注：上述用法仅为示例，需满足审批条件。</p></div><p>相关稿件：海南鲜胶乳（折干胶）月均价格为88888元/吨。</p>';
  const r=normalizeReport(html,'monthly_report',now);
  assert.equal(r.metrics[0].value,16271);
  assert.equal(r.paragraphs.length,3);
  assert.ok(r.paragraphs.some(x=>x.startsWith('国内主销区')));
  assert.ok(r.paragraphs.some(x=>x.startsWith('备注')));
  assert.ok(!r.paragraphs.some(x=>/导航|相关稿件/.test(x)));
  assert.throws(()=>articleParagraphs('<div class=TRS_Editor><p>正文尚未关闭</p>'),e=>e.code==='INVALID_PUBLIC_DATA');
});
test('pest bulletin extraction keeps numbered monitoring and registration restrictions without keyword filtering',()=>{
  const html=article('加强橡胶树病害监测与防治','引言')+'<div class=TRS_Editor><p>一、监测：每周记录现场症状并交专家复核。</p><p>二、限制：此项措施未登记，不能直接应用。</p></div>';
  const r=normalizeReport(html,'pest_updates',now);
  assert.equal(r.paragraphs.length,2);
  assert.ok(r.paragraphs[1].includes('未登记'));
});
test('statistics reject unfinished/invalid periods and never invent a dry-rubber import basis',()=>{
  const price='海南鲜胶乳（折干胶）月均价格为16271元/吨。';
  for(const title of ['2026年13月天然橡胶市场动态','2026年9月天然橡胶市场动态'])assert.throws(()=>normalizeReport(article(title,price),'monthly_report',now),e=>e.code==='INVALID_PUBLIC_DATA');
  for(const month of ['13','9'])assert.throws(()=>normalizeReport(article('2026年8月天然橡胶市场动态',price+`2026年${month}月我国进口天然橡胶（折干胶）19.14万吨。`),'monthly_report',now),e=>e.code==='INVALID_PUBLIC_DATA');
  const unknownBasis=normalizeReport(article('2026年8月天然橡胶市场动态',price+'2026年7月我国进口天然橡胶19.14万吨。'),'monthly_report',now);
  assert.equal(unknownBasis.metrics.length,1);
});
test('national production requires an actual annual production fact, not an import value or related title',()=>{
  const html=article('2025年天然橡胶产量达97.3万吨','2025年我国进口天然橡胶（折干）649.2万吨。');
  assert.throws(()=>normalizeReport(html,'production_national',now),e=>e.code==='INVALID_PUBLIC_DATA');
  const r=normalizeReport(article('2025年天然橡胶产量达97.3万吨','2025年我国天然橡胶产量达97.3万吨。2024年我国进口天然橡胶（折干）500万吨。'),'production_national',now);
  assert.equal(r.metrics.length,1,'cannot relabel the prior year import with the production year');
});
