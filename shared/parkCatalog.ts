export type RegionId = 'yunnan' | 'hainan' | 'guangdong';
export type Site = 'hainan' | 'hainan-danzhou' | 'hainan-baoting' | 'xsbn' | 'yunnan-mengla' | 'yunnan-menghai' | 'guangdong-zhanjiang' | 'guangdong-maoming' | 'guangdong-yangjiang' | 'xian';
export type ParkDefinition = {
  key: Site;
  siteId: string;
  name: string;
  regionId: RegionId | null;
  treePrefix: string;
  center: {longitude: number; latitude: number};
  elevationM: number;
  climate: 'tropical' | 'tropical_highland' | 'subtropical' | 'temperate_trial';
  offset: number;
  sceneTemplate: 'hainan' | 'xsbn' | 'xian';
};

export const regions: Record<RegionId, {id: RegionId; name: string; center: {longitude: number; latitude: number}}> = {
  yunnan: {id: 'yunnan', name: '云南', center: {longitude: 101.05, latitude: 21.85}},
  hainan: {id: 'hainan', name: '海南', center: {longitude: 109.85, latitude: 19.2}},
  guangdong: {id: 'guangdong', name: '广东', center: {longitude: 111.05, latitude: 21.55}},
};
export const productionRegions: RegionId[] = ['yunnan', 'hainan', 'guangdong'];

// Locations and boundaries describe demo plantations, not surveyed real farms.
// A park key is a data scope; sceneTemplate only selects reusable visual assets.
export const parks: Record<Site, ParkDefinition> = {
  hainan: {key: 'hainan', siteId: 'demo-hainan', name: '海南海口模拟园区', regionId: 'hainan', treePrefix: 'HN', center: {longitude: 110.3, latitude: 19.8}, elevationM: 42, climate: 'tropical', offset: 0, sceneTemplate: 'hainan'},
  'hainan-danzhou': {key: 'hainan-danzhou', siteId: 'demo-hainan-danzhou', name: '海南儋州模拟园区', regionId: 'hainan', treePrefix: 'HN-DZ', center: {longitude: 109.57, latitude: 19.52}, elevationM: 85, climate: 'tropical', offset: 21, sceneTemplate: 'hainan'},
  'hainan-baoting': {key: 'hainan-baoting', siteId: 'demo-hainan-baoting', name: '海南保亭模拟园区', regionId: 'hainan', treePrefix: 'HN-BT', center: {longitude: 109.7, latitude: 18.64}, elevationM: 180, climate: 'tropical', offset: 28, sceneTemplate: 'hainan'},
  xsbn: {key: 'xsbn', siteId: 'demo-xsbn', name: '云南景洪模拟园区', regionId: 'yunnan', treePrefix: 'XS', center: {longitude: 100.8, latitude: 22}, elevationM: 615, climate: 'tropical_highland', offset: 7, sceneTemplate: 'xsbn'},
  'yunnan-mengla': {key: 'yunnan-mengla', siteId: 'demo-yunnan-mengla', name: '云南勐腊模拟园区', regionId: 'yunnan', treePrefix: 'YN-ML', center: {longitude: 101.56, latitude: 21.48}, elevationM: 640, climate: 'tropical_highland', offset: 35, sceneTemplate: 'xsbn'},
  'yunnan-menghai': {key: 'yunnan-menghai', siteId: 'demo-yunnan-menghai', name: '云南勐海模拟园区', regionId: 'yunnan', treePrefix: 'YN-MH', center: {longitude: 100.45, latitude: 21.96}, elevationM: 1050, climate: 'tropical_highland', offset: 42, sceneTemplate: 'xsbn'},
  'guangdong-zhanjiang': {key: 'guangdong-zhanjiang', siteId: 'demo-guangdong-zhanjiang', name: '广东湛江模拟园区', regionId: 'guangdong', treePrefix: 'GD-ZJ', center: {longitude: 110.25, latitude: 21.2}, elevationM: 38, climate: 'subtropical', offset: 49, sceneTemplate: 'hainan'},
  'guangdong-maoming': {key: 'guangdong-maoming', siteId: 'demo-guangdong-maoming', name: '广东茂名模拟园区', regionId: 'guangdong', treePrefix: 'GD-MM', center: {longitude: 110.93, latitude: 21.67}, elevationM: 55, climate: 'subtropical', offset: 56, sceneTemplate: 'hainan'},
  'guangdong-yangjiang': {key: 'guangdong-yangjiang', siteId: 'demo-guangdong-yangjiang', name: '广东阳江模拟园区', regionId: 'guangdong', treePrefix: 'GD-YJ', center: {longitude: 111.85, latitude: 21.9}, elevationM: 73, climate: 'subtropical', offset: 63, sceneTemplate: 'hainan'},
  xian: {key: 'xian', siteId: 'demo-xian', name: '西安模拟试验站', regionId: null, treePrefix: 'XA', center: {longitude: 108.9, latitude: 34.3}, elevationM: 405, climate: 'temperate_trial', offset: 14, sceneTemplate: 'xian'},
};
// Organisation nodes are shown on the China map apart from the production parks: the data
// and cloud-brain center grows no rubber, and the Xi'an station only runs trials.
export type OrgNodeId = 'hangzhou' | 'xian';
export const orgNodes: Record<OrgNodeId, {id: OrgNodeId; name: string; short: string; role: string; center: {longitude: number; latitude: number}; note: string; site: Site | null}> = {
  hangzhou: {id: 'hangzhou', name: '杭州数据与云脑中心', short: '杭州 · 数据中心', role: '数据与云脑中心', center: {longitude: 120.16, latitude: 30.27}, note: '汇聚各园区数据，比较园区、审批全园策略与小脑参数；不种植橡胶，不计入产胶园区。', site: null},
  xian: {id: 'xian', name: parks.xian.name, short: '西安 · 试验站', role: '研发试验站', center: parks.xian.center, note: '设备联调与割胶机器人试验；试验作业不登记生产收胶。', site: 'xian'},
};
export const orgNodeIds: OrgNodeId[] = ['hangzhou', 'xian'];
export const productionSites: Site[] = productionRegions.flatMap(region => (Object.keys(parks) as Site[]).filter(site => parks[site].regionId === region));
export const sites = Object.fromEntries(Object.values(parks).map(park => [park.key, park.name])) as Record<Site, string>;
