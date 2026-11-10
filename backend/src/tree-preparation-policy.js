// Background refresh may update advice, but never revoke a person's stop/skip
// or silently substitute an angle already adopted for an execution task.
export function treePreparationSkipReason({store,treeId,siteId='demo-hainan',kind,dataMode='mixed_demo',now=new Date(),background=false,refreshReason='scheduled',preserveConfigured=false,requireBrain=false}) {
  if(!background&&!preserveConfigured)return null;
  const binding=store.getTreeViewBinding(treeId,kind,dataMode,siteId);
  const run=binding&&store.getRun(binding.runId),strategy=run?.result?.strategy;
  if(strategy?.qualityReview?.status==='withdrawn')return 'withdrawn';
  const hasActions=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='simulation_actions'").get();
  if(hasActions&&kind==='tapping_angle'&&store.db.prepare("SELECT 1 FROM simulation_actions WHERE tree_id=? AND kind='adopt_angle' AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? LIMIT 1").get(treeId,siteId))return 'angle_adopted';
  if(hasActions&&kind==='surface_action') {
    const row=store.db.prepare("SELECT body FROM simulation_actions WHERE tree_id=? AND kind='surface_review' AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? ORDER BY sequence DESC LIMIT 1").get(treeId,siteId);
    const action=row&&JSON.parse(row.body);
    if(action?.disposition==='skip'&&Date.parse(action.expiresAt)>+now)return 'review_skip';
  }
  if(run&&['queued','running'].includes(run.status)&&(background||run.request.generatorMode==='configured'))return 'pending';
  const usable=run?.status==='succeeded'&&strategy&&Date.parse(strategy.expiresAt)>+now;
  // A configured request may have been served by simple rules. Only a real
  // model result or a labelled attempted-model fallback satisfies an upgrade.
  const brainAttempt=strategy?.provenance?.mode==='estimated'||Boolean(strategy?.fallback);
  // Explicit rule-only bulk preparation keeps the selected model record even
  // when expired. Background refresh is allowed to renew expired evidence.
  if((usable||!background&&run?.status==='succeeded')&&preserveConfigured&&run.request.generatorMode==='configured'&&(!requireBrain||brainAttempt))return 'configured_available';
  if(usable&&background&&['startup','site_activated'].includes(refreshReason)&&!requireBrain)return 'current_available';
  return null;
}
