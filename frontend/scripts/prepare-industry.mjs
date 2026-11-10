// Called only by explicit startup preparation. Public snapshots are already
// cached; neither source refresh nor model/automatic control is changed here.
export async function prepareIndustry(call, {dataMode, stamp, now=Date.now(), reason='startup'}) {
  const previous = await call(`/internal/harness/runs?kind=industry_brief&dataMode=${dataMode}&generatorMode=configured&limit=1`);
  const configured = previous.items[0];
  const strategy=configured?.result?.strategy??configured?.strategy;
  if (configured && (['queued','running'].includes(configured.status)||strategy?.qualityReview?.status==='withdrawn'||configured.status==='succeeded'&&Date.parse(strategy?.expiresAt)>now)) return {...configured, key:'industry', title:'行业与经营 · 模型记录', preservedConfigured:true};
  const rules=await call(`/internal/harness/runs?kind=industry_brief&dataMode=${dataMode}&generatorMode=demo_rules&limit=1`),last=rules.items[0],rule=last?.result?.strategy??last?.strategy;
  if(last&&(['queued','running'].includes(last.status)||rule?.qualityReview?.status==='withdrawn'||reason!=='scheduled'&&last.status==='succeeded'&&Date.parse(rule?.expiresAt)>now))return {...last,key:'industry',title:'行业与经营 · 规则演示',preserved:true};
  const context = await call('/api/sources/industry-context', {dataMode});
  const job = await call('/internal/harness/runs', {requestId:`ui-${stamp}-industry`, kind:'industry_brief', siteId:context.siteId, targetSnapshotId:context.targetSnapshotId, inputSnapshot:context.inputSnapshot, executionMode:'simulation', generatorMode:'demo_rules', trigger:{type:'user', eventId:`ui-${stamp}-industry`}});
  return {...job, key:'industry', title:'行业与经营 · 规则演示'};
}
