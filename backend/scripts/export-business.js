import { mkdirSync, writeFileSync } from 'node:fs';
import { makeBusinessDemo } from '../src/adapters/business-demo.js';
const now=new Date();
mkdirSync('data/business-demo',{recursive:true});
writeFileSync('data/business-demo/records.json',JSON.stringify({mode:'simulated',asOf:now.toISOString(),description:'固定虚构场景在当前演示时间重放；不是实际生产记录或官方资料。',records:makeBusinessDemo(now)},null,2)+'\n');
console.log('Exported labeled business demo records to data/business-demo/records.json');
