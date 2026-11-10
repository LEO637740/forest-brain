export type ReviewPurpose='surface'|'growth'|'health';
type ReviewRecord={treeId:string;kind:string;purpose?:string};
type ReviewIssue={health:unknown[];reason:string};

export function reviewPurpose(kind:string|undefined,healthOnly:boolean,issue?:ReviewIssue):ReviewPurpose{
 if(healthOnly||kind==='inspect'&&(Boolean(issue?.health.length)||issue?.reason.includes('健康')))return 'health';
 return kind==='measure'?'growth':'surface';
}

export function matchesReviewPurpose(job:ReviewRecord,purpose:ReviewPurpose){
 if(job.purpose)return job.purpose===purpose;
 // Earlier inspect receipts updated both surface and health evidence.
 if(job.kind==='inspect')return purpose==='surface'||purpose==='health';
 return (job.kind==='measure'?'growth':'surface')===purpose;
}

export function selectReviewJob<T extends ReviewRecord>(items:T[],treeId:string|undefined,kind:string|undefined,purpose:ReviewPurpose,history=false):T|undefined{
 return items.find(job=>job.treeId===treeId&&(history||job.kind===kind&&matchesReviewPurpose(job,purpose)));
}
