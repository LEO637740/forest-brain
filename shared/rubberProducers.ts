// Natural rubber production by country, FAOSTAT QCL (item 836 "Natural rubber in primary forms",
// element 5510 Production, unit t), year 2024, bulk release dated 2025-12-23. The 25 countries listed
// produced at least 10,000 t each and together 14811166 t of the world's 14829085 t.
// Extract kept at verification/map-world-trees-20261027/faostat-natural-rubber-836.csv.
// `position` only places the marker inside the main growing area; it is not a plantation coordinate.
export type ProducerFlag = 'official' | 'external' | 'estimated' | 'imputed';
export type RubberProducer = {m49: string; name: string; fao: string; tonnes: number; flag: ProducerFlag; position: {longitude: number; latitude: number}};

export const RUBBER_PRODUCTION_SOURCE = {
  title: 'FAOSTAT 作物与畜产品生产（天然橡胶，初级形态）',
  year: 2024,
  released: '2025-12-23',
  url: 'https://www.fao.org/faostat/en/#data/QCL',
  worldTonnes: 14829085,
} as const;

export const FLAG_LABELS: Record<ProducerFlag, string> = {official: '官方数据', external: '国际组织数据', estimated: 'FAO 估算', imputed: 'FAO 插补'};

/** 量级 by annual output: 100万吨以上 / 10–100万吨 / 1–10万吨. */
export type ProductionTier = 'major' | 'large' | 'medium';
export const TIER_LABELS: Record<ProductionTier, string> = {major: '100 万吨以上', large: '10–100 万吨', medium: '1–10 万吨'};
export const productionTier = (tonnes: number): ProductionTier => tonnes >= 1_000_000 ? 'major' : tonnes >= 100_000 ? 'large' : 'medium';

export const RUBBER_PRODUCERS: RubberProducer[] = [
  {m49:'764',name:'泰国',fao:"Thailand",tonnes:4789042,flag:'official',position:{longitude:101.0,latitude:14.5}},
  {m49:'360',name:'印度尼西亚',fao:"Indonesia",tonnes:2262088,flag:'official',position:{longitude:104.5,latitude:-2.0}},
  {m49:'384',name:'科特迪瓦',fao:"Côte d'Ivoire",tonnes:1686599,flag:'official',position:{longitude:-5.5,latitude:6.6}},
  {m49:'704',name:'越南',fao:"Viet Nam",tonnes:1327473,flag:'official',position:{longitude:106.8,latitude:11.8}},
  {m49:'159',name:'中国',fao:"China",tonnes:877600,flag:'external',position:{longitude:104.5,latitude:22.8}},
  {m49:'356',name:'印度',fao:"India",tonnes:876000,flag:'external',position:{longitude:76.6,latitude:9.9}},
  {m49:'116',name:'柬埔寨',fao:"Cambodia",tonnes:527200,flag:'external',position:{longitude:105.0,latitude:12.4}},
  {m49:'458',name:'马来西亚',fao:"Malaysia",tonnes:386512,flag:'official',position:{longitude:101.9,latitude:3.8}},
  {m49:'608',name:'菲律宾',fao:"Philippines",tonnes:364557,flag:'official',position:{longitude:125.0,latitude:7.6}},
  {m49:'418',name:'老挝',fao:"Lao People's Democratic Republic",tonnes:350300,flag:'external',position:{longitude:102.4,latitude:19.4}},
  {m49:'104',name:'缅甸',fao:"Myanmar",tonnes:330300,flag:'external',position:{longitude:97.3,latitude:16.4}},
  {m49:'076',name:'巴西',fao:"Brazil",tonnes:263672,flag:'official',position:{longitude:-49.0,latitude:-21.0}},
  {m49:'288',name:'加纳',fao:"Ghana",tonnes:136500,flag:'external',position:{longitude:-1.8,latitude:6.0}},
  {m49:'430',name:'利比里亚',fao:"Liberia",tonnes:129900,flag:'external',position:{longitude:-9.6,latitude:6.6}},
  {m49:'320',name:'危地马拉',fao:"Guatemala",tonnes:95800,flag:'external',position:{longitude:-91.2,latitude:14.7}},
  {m49:'484',name:'墨西哥',fao:"Mexico",tonnes:91401,flag:'official',position:{longitude:-95.3,latitude:17.9}},
  {m49:'144',name:'斯里兰卡',fao:"Sri Lanka",tonnes:69271,flag:'official',position:{longitude:80.3,latitude:6.9}},
  {m49:'566',name:'尼日利亚',fao:"Nigeria",tonnes:65300,flag:'external',position:{longitude:6.0,latitude:6.3}},
  {m49:'120',name:'喀麦隆',fao:"Cameroon",tonnes:55700,flag:'external',position:{longitude:11.0,latitude:3.6}},
  {m49:'266',name:'加蓬',fao:"Gabon",tonnes:27800,flag:'external',position:{longitude:11.6,latitude:0.4}},
  {m49:'624',name:'几内亚比绍',fao:"Guinea-Bissau",tonnes:25000,flag:'external',position:{longitude:-15.0,latitude:12.0}},
  {m49:'050',name:'孟加拉国',fao:"Bangladesh",tonnes:23000,flag:'external',position:{longitude:91.8,latitude:22.4}},
  {m49:'218',name:'厄瓜多尔',fao:"Ecuador",tonnes:19605,flag:'estimated',position:{longitude:-79.5,latitude:-1.4}},
  {m49:'170',name:'哥伦比亚',fao:"Colombia",tonnes:15300,flag:'external',position:{longitude:-74.0,latitude:4.4}},
  {m49:'324',name:'几内亚',fao:"Guinea",tonnes:15246,flag:'imputed',position:{longitude:-10.9,latitude:9.9}},
];
