export const SOURCE_REQUIREMENTS = [
  {id:'regional_weather',category:'互联网与天气',requirement:'天气预报、区域环境与土壤参考',sources:['weather'],boundary:'模型格点值；地点待确认时仅为参考点。',fields:['园区经纬度','现场雨量','现场温湿度']},
  {id:'prices',category:'互联网与天气',requirement:'橡胶期货及区域现货价格',sources:['market','monthly_report'],boundary:'期货合约与区域月均价分开，不替代园区当日成交。',fields:['实际售价','品级','干胶折算口径']},
  {id:'production',category:'互联网与行业统计',requirement:'全国、海南及其他产区供给信息',sources:['production_national','production_hainan','monthly_report'],boundary:'年度数量与月度供给描述；尚非全球各产区完整产量数据库。',fields:['园区产量','单树产胶量']},
  {id:'trade',category:'互联网与行业统计',requirement:'贸易与进口',sources:['monthly_report','production_national'],boundary:'官方报告转述海关统计，保留进口统计月份，不是企业订单。',fields:['销售订单','采购订单']},
  {id:'public_stock',category:'互联网与行业统计',requirement:'仓储宏观参考',sources:['warehouse'],boundary:'交易所注册仓单，不是全国总库存或企业可售库存。',fields:['企业批次库存']},
  {id:'pest_knowledge',category:'科研与专业知识',requirement:'病虫害年度风险与专家指导',sources:['bulletin','pest_updates'],boundary:'政府公开专业资料；尚未接橡胶所专有数据库或验证单树诊断。',fields:['园区巡查','物候','真实症状']},
  {id:'sensors',category:'传感器与设备',requirement:'现场环境、设备状态与图像',sources:[],boundary:'由设备／MH 业务系统提供，已提供上下文接入协议，尚无实际设备服务。',fields:['观测时间','单位','质量','设备编号','图像/检测结果']},
  {id:'trees',category:'传感器与业务档案',requirement:'单树历史、生长、割面与作业记录',sources:[],boundary:'200 棵树仍为模拟。真实树、行、地块和历史需业务后端提供。',fields:['treeId','rowId','blockId','尺寸','割面','作业历史']},
  {id:'research',category:'科研合作伙伴',requirement:'橡胶所数据、农艺模型与技术约束',sources:[],boundary:'没有合作方接口或资料授权；公开公告不能冒充合作方内部数据。',fields:['模型版本','试验数据','适用范围','已确认约束']},
  {id:'farmer_expert',category:'胶农与专家',requirement:'经验、人工复核、实际成本与产量',sources:[],boundary:'可通过业务上下文导入经审核的规则和假设；现有演示经验不是专家实录。',fields:['录入人','来源','版本','实际成本','单次产量']},
  {id:'processing',category:'企业生产经营',requirement:'加工与质量管理',sources:[],boundary:'需企业批次与质检记录，不能按天气推测胶品质量。',fields:['批次编号','加工阶段','数量','含水率/品级','质检时间']},
  {id:'storage_transport',category:'企业生产经营',requirement:'企业库存、仓储与运输',sources:[],boundary:'需 ERP/WMS/TMS 或人工记录；无记录时只建议补采和复核。',fields:['批次库存','仓库位置','入出库时间','运单','运输状态','预计到达时间']},
];
export function sourceCoverage(status) {
  return SOURCE_REQUIREMENTS.map(item => { const available=item.sources.filter(id=>status.sources.some(s=>s.id===id&&s.data&&!s.stale));return {...item,availableSources:available,status:!item.sources.length?'business_data_required':available.length===item.sources.length?'public_reference_available':available.length?'partial':'unavailable'}; });
}
