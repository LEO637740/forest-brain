export type TreeSample = {index:number; block:string; taps:number; latex:number};
export type AnalyticsDatum = {date:string; actual:number; forecast:number; rain:number; taps:number; treeSamples?:TreeSample[]};

/** Reuse the same illustrative daily allocation for park, plot and block totals. */
export function allocateTreeSamples(rows:AnalyticsDatum[], offset=0):TreeSample[] {
  const trees = new Map<number,TreeSample>();
  rows.forEach((row,day) => {
    const samples = row.treeSamples ?? Array.from({length:200},(_,index) => ({index,block:'ABCD'[Math.floor(index/50)],taps:0,latex:0}));
    if (!row.treeSamples) {
      const active = samples.filter(tree => (tree.index*73+(day+offset)*37)%200 < row.taps);
      const weight = (index:number) => .6+((index*37)%101)/100;
      const sum = active.reduce((total,tree) => total+weight(tree.index),0);
      active.forEach(tree => {tree.taps=1; tree.latex=row.actual*weight(tree.index)/sum;});
    }
    samples.forEach(tree => {
      const total = trees.get(tree.index) ?? {...tree,taps:0,latex:0};
      total.taps += tree.taps; total.latex += tree.latex; trees.set(tree.index,total);
    });
  });
  return [...trees.values()];
}

/** Scope once at daily-tree granularity so totals and details stay in agreement. */
export function treeScopeSeries(rows:AnalyticsDatum[], treeIndices?:number[], offset=0):AnalyticsDatum[] {
  if (treeIndices === undefined) return rows;
  const allowed = new Set(treeIndices);
  return rows.map((row,day) => {
    const treeSamples = allocateTreeSamples([row],offset+day).filter(tree => allowed.has(tree.index));
    const actual = treeSamples.reduce((sum,tree) => sum+tree.latex,0);
    return {...row,actual,taps:treeSamples.reduce((sum,tree) => sum+tree.taps,0),
      forecast:row.actual ? row.forecast*(actual/row.actual) : 0,treeSamples};
  });
}
