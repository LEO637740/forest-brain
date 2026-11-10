import {parks, type Site} from './parkCatalog.ts';

/** Stable business identity is (siteId, treeId); a display label is never a primary key. */
export function resolveTreeIdentity(siteId:string, value:string) {
  const park = Object.values(parks).find(item => item.siteId === siteId || item.key === siteId);
  if (!park || typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  const internal = /^T-(\d{4})$/.exec(text);
  const alias = /^(.+)-([A-D])-(\d{4})$/.exec(text);
  let index:number;
  if (internal) index = Number(internal[1])-1;
  else if (alias && alias[1] === park.treePrefix && Number(alias[3]) >= 1 && Number(alias[3]) <= 50)
    index = 'ABCD'.indexOf(alias[2])*50+Number(alias[3])-1;
  else return null;
  if (!Number.isInteger(index) || index < 0 || index >= 200) return null;
  const zone = 'ABCD'[Math.floor(index/50)];
  return {siteId:park.siteId,treeId:`T-${String(index+1).padStart(4,'0')}`,index,zone,
    label:`${park.treePrefix}-${zone}-${String(index%50+1).padStart(4,'0')}`};
}

export function treeDisplayLabel(index:number, site:Site='hainan') {
  return resolveTreeIdentity(site, `T-${String(index+1).padStart(4,'0')}`)?.label ?? '';
}
