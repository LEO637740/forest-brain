import test from 'node:test';
import assert from 'node:assert/strict';
import {parks, productionRegions, productionSites} from '../../shared/parkCatalog.ts';
import {treeAlias, parseTreeAlias} from '../src/workspace/model.ts';
import {DATA, getRecentLatex, getTreeYieldSeries} from '../src/workspace/analyticsData.ts';
import {collectionPointSamples} from '../src/workspace/collectionPointData.ts';
import {siteHierarchy, scopedTasks} from '../src/workspace/workbenchModel.ts';
import {recommendationTrees} from '../src/integration/recommendationModel.ts';

test('each region has multiple independently addressable parks and unique tree aliases',()=>{
  assert.equal(productionSites.length,9);
  for(const region of productionRegions)assert.equal(productionSites.filter(site=>parks[site].regionId===region).length,3);
  const aliases=new Set();
  for(const site of Object.keys(parks)){
    for(let index=0;index<200;index++){
      const alias=treeAlias(index,site);
      assert.equal(parseTreeAlias(alias,site),index);
      assert.ok(!aliases.has(alias));aliases.add(alias);
      for(const other of Object.keys(parks).filter(key=>key!==site))assert.equal(parseTreeAlias(alias,other),null);
    }
    assert.equal(recommendationTrees(['T-0001'],parks[site].siteId),treeAlias(0,site));
    assert.equal(siteHierarchy[site].park,parks[site].name);
  }
});

test('new parks have complete distinct production and collection demo data',()=>{
  for(const site of productionSites){
    assert.equal(DATA[site].length,30);
    assert.ok(Number.isFinite(getRecentLatex(site)));
    assert.equal(getTreeYieldSeries(0,site).length,5);
    assert.equal(collectionPointSamples[site].length,3);
    assert.ok(collectionPointSamples[site].every(point=>point.site===site));
  }
  assert.notDeepEqual(DATA['hainan-danzhou'],DATA.hainan);
  assert.notDeepEqual(DATA['yunnan-mengla'],DATA.xsbn);
  assert.equal(getRecentLatex('xian'),null);
  assert.deepEqual(collectionPointSamples.xian,[]);
});

test('the same zone and tree task in neighboring parks stays scoped to its park',()=>{
  const tasks=productionSites.map(site=>({id:'T-0001',site,block:'A'}));
  for(const site of productionSites)assert.deepEqual(scopedTasks(tasks,site,'A'),[tasks.find(task=>task.site===site)]);
});
