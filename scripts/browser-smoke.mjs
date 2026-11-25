import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const port=4179;
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(port),"--strictPort"],{stdio:"inherit",env:process.env});
let browser;
let apiServer;
try{
 const url="http://127.0.0.1:"+port;
 let ready=false;
 for(let i=0;i<60;i++){try{const r=await fetch(url);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert(ready,"Production preview did not start");
 // Production Express AI API must not promote anonymous callers when an
 // environment Gemini key exists. This uses only dummy credentials.
 const apiPort=4180;
 apiServer=spawn(process.execPath,["dist/server.mjs"],{stdio:"inherit",env:{...process.env,NODE_ENV:"production",HOST:"127.0.0.1",PORT:String(apiPort),SUPABASE_URL:"",SUPABASE_ANON_KEY:"",SUPABASE_PUBLISHABLE_KEY:"",SUPABASE_SERVICE_ROLE_KEY:"",GEMINI_API_KEY:"ci-placeholder-not-a-real-key",DSMDH_LOCAL_AI:"false"}});
 let apiReady=false;
 for(let i=0;i<40;i++){try{if((await fetch("http://127.0.0.1:"+apiPort+"/api/health")).ok){apiReady=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 assert(apiReady,"Production API failed to boot");
 const apiRoutes=[...readFileSync("server.ts","utf8").matchAll(/app\.post\("\/api\/([^"]+)"/g)].map(m=>m[1]);
 assert(apiRoutes.length>=16,"API route registry unexpectedly shrank");
 for(const route of apiRoutes){
  const res=await fetch("http://127.0.0.1:"+apiPort+"/api/"+route,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(res.status,401,"Anonymous AI API request accepted: "+route);
 }
 console.log("PASS production API health and all registered anonymous AI endpoint denials");
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(url,{waitUntil:"domcontentloaded"});
 await page.getByText("Owner Confidential Area",{exact:true}).first().waitFor({timeout:30000});
 await page.getByText("Login (ID / Password)",{exact:true}).click();
 await page.getByText("Sales / New Bill",{exact:true}).first().waitFor({timeout:30000});
 await page.getByText("Sales / New Bill",{exact:true}).first().click();
 await page.getByText("Photo Stock Finder",{exact:true}).first().click();
 // Fresh isolated owner context, no production account or credentials.
 const owner=await browser.newPage({viewport:{width:1440,height:900}});
 owner.on("pageerror",e=>errors.push(e.message));
 await owner.goto(url,{waitUntil:"domcontentloaded"});
 await owner.getByText("Owner Confidential Area",{exact:true}).first().click();
 await owner.getByPlaceholder("Enter Owner Device PIN").fill("1234");
 await owner.getByRole("button",{name:"Unlock",exact:true}).click();
 await owner.getByText("All Products",{exact:true}).first().waitFor({timeout:30000});
 await owner.getByText("Sales / New Bill",{exact:true}).first().click();
 // Exercise a real checkout in the isolated browser's local-only database.
 // No customer phone, external notification, production account or real sale.
 await owner.evaluate(()=>{window.print=()=>{};});
 await owner.getByRole("button",{name:"+ Custom Service"}).click();
 await owner.getByPlaceholder("e.g. SIM Cutting, Mobile Polish, Data Backup").fill("CI test service");
 await owner.getByPlaceholder("e.g. 50",{exact:true}).fill("50");
 await owner.getByRole("button",{name:/Add to Cart/}).click();
 await owner.getByRole("button",{name:/Complete Checkout & Print Bill/}).click();
 await owner.getByRole("button",{name:"Generate & Print Invoice"}).click();
 await owner.waitForFunction(()=>{
   try{
     const raw=localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2");
     return !!raw&&JSON.parse(raw).sales?.some(s=>s.items?.some(i=>i.name==="CI test service"&&i.isService===true));
   }catch{return false;}
 },{},{timeout:30000});
 const record=await owner.evaluate(()=>{
   const db=JSON.parse(localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2"));
   return db.sales.find(s=>s.items.some(i=>i.name==="CI test service"));
 });
 assert.equal(record.items.length,1);
 assert.equal(record.items[0].price,50);
 assert.equal(record.items[0].cost,0);
 assert.equal(record.status,"Paid");
 assert.equal(record.amountPaid,record.total);
 console.log("PASS actual local-only counter-service checkout, invoice and persisted payment");
 // Exercise every registered module in a fresh local owner context.
 const directory=await browser.newPage({viewport:{width:1440,height:900}});
 directory.on("pageerror",e=>errors.push(e.message));
 await directory.goto(url,{waitUntil:"domcontentloaded"});
 await directory.getByText("Owner Confidential Area",{exact:true}).first().click();
 await directory.getByPlaceholder("Enter Owner Device PIN").fill("1234");
 await directory.getByRole("button",{name:"Unlock",exact:true}).click();
 const navSource=readFileSync("src/components/Sidebar.tsx","utf8");
 const modules=[...navSource.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(m=>({key:m[1],label:m[2]}));
 assert(modules.length>=52,"Feature registry unexpectedly shrank");
 assert.equal(new Set(modules.map(m=>m.key)).size,modules.length);
 const search=directory.getByRole("textbox",{name:"Search tools"});
 for(const module of modules){
   await search.fill(module.key);
   await directory.locator('[data-tool-key="'+module.key+'"]').click();
   await directory.locator('#page[data-current-page="'+module.key+'"]').waitFor();
   await directory.waitForFunction(()=>!document.querySelector("#page")?.textContent?.includes("Loading view..."));
   assert((await directory.locator("#page").innerText()).trim().length>0,"Empty module "+module.key);
   console.log("PASS module render:",module.key);
 }
 console.log("PASS registered owner modules:",modules.length);
 await search.fill("appearanceStudio");
 await directory.locator('[data-tool-key="appearanceStudio"]').click();
 await directory.getByRole("button",{name:/Cinematic 3D/}).click();
 assert.equal(await directory.locator("html").getAttribute("data-retail-motion"),"cinematic");
 await directory.getByRole("button",{name:/Minimal motion/}).click();
 assert.equal(await directory.locator("html").getAttribute("data-retail-motion"),"quiet");
 await search.fill("dashboard");await directory.locator('[data-tool-key="dashboard"]').click();
 await directory.locator(".retail-hero-dashboard .retail-phone").waitFor();
 console.log("PASS motion preference and 3D dashboard artwork");
 await directory.getByRole("button",{name:"Open global tool search"}).click();
 await directory.getByRole("textbox",{name:"Find a tool"}).fill("appearanceStudio");
 await directory.locator('[data-command-key="appearanceStudio"]').click();
 await directory.locator('#page[data-current-page="appearanceStudio"]').waitFor();
 const ids=[...readFileSync("theme/themes.ts","utf8").matchAll(/id: "([a-z]+)",/g)].map(m=>m[1]);
 assert.equal(ids.length,11);
 for(const id of ids){
  await directory.locator('[data-theme-choice="'+id+'"]').click();
  for(const mode of ["Light","Dark"]){
   await directory.getByRole("button",{name:mode,exact:true}).click();
   assert.equal(await directory.locator("html").getAttribute("data-theme"),id);
   assert.equal(await directory.locator("html").getAttribute("data-mode"),mode.toLowerCase());
   const tokens=await directory.evaluate(()=>["--canvas","--surface","--ink","--brand","--accent"].map(k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim()));
   assert(tokens.every(v=>/^#[0-9a-f]{6}$/i.test(v)),"Theme token missing: "+id+"/"+mode);
  }
 }
 console.log("PASS all 22 light/dark palettes and global tool search");
 await search.fill("products");await directory.locator('[data-tool-key="products"]').click();
 await directory.getByRole("textbox",{name:"Search inventory"}).fill("zzzz-ci-no-matching-product");
 await directory.getByText("No matching products. Try another search or reset filters.").waitFor();
 await directory.getByRole("button",{name:"Reset filters"}).click();
 assert.equal(await directory.getByRole("textbox",{name:"Search inventory"}).inputValue(),"");
 console.log("PASS inventory search and filter reset");
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 mobile.on("pageerror",e=>errors.push(e.message));
 await mobile.goto(url,{waitUntil:"domcontentloaded"});
 await mobile.getByText("Owner Confidential Area",{exact:true}).first().click();
 await mobile.getByPlaceholder("Enter Owner Device PIN").fill("1234");
 await mobile.getByRole("button",{name:"Unlock",exact:true}).click();
 await mobile.getByRole("button",{name:"More",exact:true}).click();
 const mobileSearch=mobile.getByRole("textbox",{name:"Search tools"});
 await mobileSearch.fill("backup");
 await mobile.getByRole("button",{name:"Backup & Restore",exact:true}).first().click();
 await mobile.waitForFunction(()=>!document.querySelector("#sidebar")?.classList.contains("mobile-open"));
 const sizes=await mobile.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,tab:document.querySelector(".bottom-tab-bar")?.getBoundingClientRect().height||0}));
 assert(sizes.scroll<=sizes.width+1,"Mobile page horizontal overflow");
 assert(sizes.tab>=48,"Mobile navigation touch target too small");
 console.log("PASS responsive mobile drawer, module search, navigation and viewport");
 assert.deepEqual(errors,[],"Uncaught browser errors");
 console.log("PASS production UI boot, local-mode entry, local owner/staff entry and inventory/POS navigation");
}finally{await browser?.close();apiServer?.kill();server.kill();}
