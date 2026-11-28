import {describe,it,expect} from "vitest";
import {visionFallbackParams} from "../../supabase/functions/ai-gateway/vision-fallback";
const p={model:"configured-vision",contents:{parts:[{inlineData:{data:"abc",mimeType:"image/png"}},{text:"OCR"}]},config:{thinkingConfig:{thinkingBudget:0},responseMimeType:"application/json"}};
describe("bounded Gemini vision model fallback",()=>{
 it("retains the exact image/schema and removes rejected thinking config",()=>{const q=visionFallbackParams(p,{status:400,message:"unsupported thinking budget"},"gemini-3.5-flash-lite");expect(q.model).toBe("gemini-3.5-flash-lite");expect(q.contents).toEqual(p.contents);expect(q.config).toEqual({responseMimeType:"application/json"});expect(p.config.thinkingConfig).toBeDefined();});
 it("supports model availability and quota fallback but not credentials or same model",()=>{for(const status of [404,429])expect(visionFallbackParams(p,{status},"gemini-3.5-flash-lite")).not.toBeNull();for(const status of [401,403,500])expect(visionFallbackParams(p,{status},"gemini-3.5-flash-lite")).toBeNull();expect(visionFallbackParams(p,{status:429},p.model)).toBeNull();});
 it("does not retry text calls or arbitrary validation errors",()=>{expect(visionFallbackParams({...p,contents:{parts:[{text:"hi"}]}},{status:404},"fallback")).toBeNull();expect(visionFallbackParams(p,{status:400,message:"malformed request"},"fallback")).toBeNull();});
});
