export function isInvoiceTemplate(template:any,name:string,language:string):boolean{
 if(template?.name!==name||template?.language!==language||template?.status!=="APPROVED"||template?.category!=="UTILITY"||!Array.isArray(template.components))return false;
 const body=template.components.filter((c:any)=>c?.type==="BODY");
 if(body.length!==1||typeof body[0].text!=="string")return false;
 const params=[...body[0].text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map(x=>x[1].trim());
 if(params.length!==4||new Set(params).size!==4||!["1","2","3","4"].every(x=>params.includes(x)))return false;
 // This sender supplies exactly four positional BODY parameters, not
 // dynamic headers, media, named variables, buttons or URL suffixes.
 return template.components.every((c:any)=>c.type==="BODY"||c.type==="FOOTER"&&typeof c.text==="string"&&!c.text.includes("{{")||c.type==="HEADER"&&c.format==="TEXT"&&typeof c.text==="string"&&!c.text.includes("{{"));
}
export function consentValid(at:string|null,now=Date.now()):boolean{
 const ms=typeof at==="string"?Date.parse(at):NaN;
 return Number.isFinite(ms)&&ms<=now&&now-ms<=7*86400000;
}
