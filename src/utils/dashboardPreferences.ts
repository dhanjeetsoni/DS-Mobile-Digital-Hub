export const DASHBOARD_METRICS=["sales","cash","due","repairs"] as const;
export type MetricId=typeof DASHBOARD_METRICS[number];
export type MetricPreference={id:MetricId;hidden:boolean;wide:boolean};
export function normalizeMetrics(value:unknown):MetricPreference[]{
 const defaults=DASHBOARD_METRICS.map(id=>({id,hidden:false,wide:false}));
 if(!Array.isArray(value))return defaults;
 const valid:MetricPreference[]=[];
 for(const entry of value){if(!entry||typeof entry!=="object"||!DASHBOARD_METRICS.includes(entry.id)||valid.some(x=>x.id===entry.id))continue;valid.push({id:entry.id,hidden:entry.hidden===true,wide:entry.wide===true});}
 return [...valid,...defaults.filter(x=>!valid.some(v=>v.id===x.id))];
}
export function moveMetric(items:MetricPreference[],source:MetricId,target:MetricId){const from=items.findIndex(x=>x.id===source),to=items.findIndex(x=>x.id===target);if(from<0||to<0||from===to)return items;const next=[...items];const [item]=next.splice(from,1);next.splice(to,0,item);return next;}
