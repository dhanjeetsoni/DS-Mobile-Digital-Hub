// Only bounded image-generation fallback (no arbitrary alternate model,
// no retries on authentication failures, and never retry text requests).
export function visionFallbackParams(params:any,error:any,fallbackModel:string):any|null{
 const parts=params?.contents?.parts;
 if(!Array.isArray(parts)||!parts.some((p:any)=>typeof p?.inlineData?.data==="string"&&p.inlineData.data.length>0))return null;
 if(!fallbackModel||params.model===fallbackModel)return null;
 const status=Number(error?.status??error?.code),message=String(error?.message??"").toLowerCase();
 const modelMismatch=status===404||status===400&&/model|thinking|unsupported|invalid.argument/.test(message);
 const modelQuota=status===429||/resource_exhausted|quota/.test(message);
 if(!modelMismatch&&!modelQuota)return null;
 if(status===401||status===403)return null;
 const config={...params.config};delete config.thinkingConfig;
 return {...params,model:fallbackModel,config};
}
