import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
const port=4179;
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(port),"--strictPort"],{stdio:"inherit",env:process.env});
let browser;
let apiServer;
try{
 const url="http://127.0.0.1:"+port;
 mkdirSync("visual-review",{recursive:true});
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
 // Exercise the actual IndexedDB implementation in a separate browser context.
 // The CI-only module is intercepted, not shipped as a production asset.
 const snapshotModule=buildSync({entryPoints:["src/services/scopedSnapshotCache.ts"],bundle:true,format:"esm",platform:"browser",write:false}).outputFiles[0].text;
 const recoveryContext=await browser.newContext();
 await recoveryContext.route("**/__ci_scoped_snapshot.mjs",route=>route.fulfill({contentType:"text/javascript",body:snapshotModule}));
 const recoveryPage=await recoveryContext.newPage();
 await recoveryPage.goto(url,{waitUntil:"domcontentloaded"});
 const recoveryInfo=await recoveryPage.evaluate(async()=>{
   const api=await import("/__ci_scoped_snapshot.mjs");
   const base={products:Array.from({length:10000},(_,i)=>({id:"ci-cloud-"+i,notes:"x".repeat(400)})),settings:{}};
   const local=structuredClone(base);local.products[9999].notes="latest unsynced change";
   await api.writeScopedSnapshot({profileId:"synthetic-owner",storeId:"synthetic-shop",version:4,state:base},local);
   return {localStorageFallback:localStorage.getItem("dsmdh_scoped_state_v1_synthetic-owner")!==null,serializedBytes:new TextEncoder().encode(JSON.stringify({base,local})).length};
 });
 assert(recoveryInfo.serializedBytes>5*1024*1024,"Large cache fixture did not exercise storage quota");
 assert.equal(recoveryInfo.localStorageFallback,false,"Large cache unexpectedly fit localStorage");
 await recoveryPage.reload({waitUntil:"domcontentloaded"});
 const recovered=await recoveryPage.evaluate(async()=>{
   const api=await import("/__ci_scoped_snapshot.mjs");
   const record=await api.readScopedSnapshot("synthetic-owner","synthetic-shop");
   const other=await api.readScopedSnapshot("synthetic-staff","synthetic-shop");
   return {length:record?.local.products.length,last:record?.local.products[9999]?.notes,version:record?.version,other};
 });
 assert.deepEqual(recovered,{length:10000,last:"latest unsynced change",version:4,other:null});
 await recoveryContext.close();
 console.log("PASS IndexedDB durable scoped 10,000-product cache recovery after reload and cross-account isolation");
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const setupLocalOwner=async p=>{
  await p.getByPlaceholder("Create Owner Device PIN").fill("5826");
  await p.getByPlaceholder("Confirm Owner Device PIN").fill("5826");
  await p.getByRole("button",{name:"Create PIN & Unlock",exact:true}).click();
  await p.locator("#app").waitFor({timeout:30000});
 };
 const testCalculator=async(p,mobile=false)=>{
  if(mobile){await p.getByRole("button",{name:"More",exact:true}).click();await p.getByRole("button",{name:"Open counter calculator",exact:true}).tap();}else await p.keyboard.press("Alt+k");
  const d=p.getByRole("dialog",{name:"Counter calculator"});
  await d.waitFor();
  const hit=async name=>{const key=d.getByRole("button",{name,exact:true});if(mobile)await key.tap();else await key.click();};
  const value=()=>d.getByTestId("calculator-result").innerText();
  await hit("All clear");for(const key of ["2","0","0","Subtract","1","0","Percent","Equals"])await hit(key);
  assert.equal(await value(),"180","Contextual percentage discount");
  await hit("All clear");for(const key of ["2","Add","3","Multiply","4","Equals"])await hit(key);
  assert.equal(await value(),"20","Chained arithmetic");
  await hit("Equals");assert.equal(await value(),"80","Repeated equals");
  await hit("All clear");for(const key of ["1","0","0"])await hit(key);
  await hit("GST & pricing");await hit("+18% GST");assert.equal(await value(),"118");
  await hit("GST & pricing");await hit("Remove 18%");assert.equal(await value(),"100");
  await hit("History");assert((await d.getByText("Recent calculations").count())===1);
  await hit("Back to keypad");await hit("All clear");
  await d.focus();await p.keyboard.type("12.5+7.5");await p.keyboard.press("Enter");
  assert.equal(await value(),"20","Keyboard calculation");
  const geom=await d.evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,vw:innerWidth,vh:innerHeight,minKey:Math.min(...Array.from(el.querySelectorAll(".ds-calc-key")).map(k=>k.getBoundingClientRect().height)),overflow:el.scrollWidth-el.clientWidth}));
  assert(geom.w<=geom.vw&&geom.h<=geom.vh&&geom.minKey>=48&&geom.overflow<=1,"Calculator layout "+JSON.stringify(geom));
  await p.screenshot({path:"visual-review/calculator-"+(mobile?"mobile":"desktop")+".png",animations:"disabled"});
  await hit("Close calculator");await d.waitFor({state:"detached"});
  console.log("PASS "+(mobile?"mobile touch":"desktop")+" calculator: arithmetic, percent, GST, history, keyboard, fit");
 };
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
 await setupLocalOwner(owner);
 await owner.getByText("All Products",{exact:true}).first().waitFor({timeout:30000});
 await owner.reload({waitUntil:"domcontentloaded"});
 await owner.getByText("Owner Confidential Area",{exact:true}).first().click();
 await owner.getByPlaceholder("Enter Owner Device PIN").fill("5826");
 await owner.getByRole("button",{name:"Unlock",exact:true}).click();
 await owner.getByText("All Products",{exact:true}).first().waitFor({timeout:30000});
 console.log("PASS local owner PIN creation and persistent unlock");
 await testCalculator(owner);
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
 await owner.getByRole("button",{name:"Close invoice",exact:true}).click();
 await owner.locator("#print-area").waitFor({state:"detached"});
 // Exercise the one-tap cybercafe entry as a distinct sale source, not a POS duplicate.
 await owner.getByRole("textbox",{name:"Search tools"}).fill("xeroxGrid");
 await owner.locator('[data-tool-key="xeroxGrid"]').click();
 await owner.locator('#page[data-current-page="xeroxGrid"]').waitFor();
 await owner.getByRole("button",{name:/Xerox B&W.*2/}).first().click();
 await owner.waitForFunction(()=>{try{const raw=localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2");return !!raw&&JSON.parse(raw).xeroxEntries?.some(e=>e.serviceType==="Xerox B&W"&&e.totalAmount===2&&e.paymentMethod==="Cash");}catch{return false;}},{},{timeout:30000});
 const cyber=await owner.evaluate(()=>JSON.parse(localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2")));
 assert.equal(cyber.xeroxEntries.filter(e=>e.serviceType==="Xerox B&W"&&e.totalAmount===2).length,1);
 assert.equal(cyber.sales.filter(s=>s.items.some(i=>i.name==="CI test service")).length,1);
 console.log("PASS actual local-only one-tap cybercafe recording; separate POS and service sources");
 // Local-only native-style operation after a real browser network disconnect.
 // This validates persistence and isolation, NOT authenticated cloud replay.
 await owner.getByRole("textbox",{name:"Search tools"}).fill("sell");
 await owner.locator('[data-tool-key="sell"]').click();
 await owner.locator('#page[data-current-page="sell"]').waitFor();
 await owner.context().setOffline(true);
 try{
  assert.equal(await owner.evaluate(()=>navigator.onLine),false);
  await owner.getByRole("button",{name:"+ Custom Service"}).click();
  await owner.getByPlaceholder("e.g. SIM Cutting, Mobile Polish, Data Backup").fill("CI offline service");
  await owner.getByPlaceholder("e.g. 50",{exact:true}).fill("75");
  await owner.getByRole("button",{name:/Add to Cart/}).click();
  await owner.getByRole("button",{name:/Complete Checkout & Print Bill/}).click();
  await owner.getByRole("button",{name:"Generate & Print Invoice"}).click();
  await owner.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2")).sales.some(s=>s.items.some(i=>i.name==="CI offline service")&&s.amountPaid===75);}catch{return false;}});
  await owner.getByRole("button",{name:"Close invoice",exact:true}).click();
 }finally{await owner.context().setOffline(false);}
 await owner.reload({waitUntil:"domcontentloaded"});
 await owner.getByText("Owner Confidential Area",{exact:true}).first().click();
 await owner.getByPlaceholder("Enter Owner Device PIN").fill("5826");
 await owner.getByRole("button",{name:"Unlock",exact:true}).click();
 await owner.getByText("All Products",{exact:true}).first().waitFor({timeout:30000});
 assert.equal(await owner.evaluate(()=>JSON.parse(localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2")).sales.filter(s=>s.items.some(i=>i.name==="CI offline service")).length),1);
 console.log("PASS disconnected local checkout, reconnect/reload persistence without duplicate");


 // Exercise every registered module in a fresh local owner context.
 const directory=await browser.newPage({viewport:{width:1440,height:900}});
 directory.on("pageerror",e=>errors.push(e.message));
 await directory.goto(url,{waitUntil:"domcontentloaded"});
 await directory.getByText("Owner Confidential Area",{exact:true}).first().click();
 await setupLocalOwner(directory);
 assert.equal(await directory.evaluate(()=>{try{return JSON.parse(localStorage.getItem("dsmdh_cache_v4")||localStorage.getItem("dsmdh_db_v2"))?.sales?.some(s=>s.items.some(i=>i.name==="CI offline service"))||false;}catch{return false;}}),false);
 console.log("PASS separate browser device context cannot read other local-only sales");
 const navSource=readFileSync("src/components/Sidebar.tsx","utf8");
 const modules=[...navSource.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(m=>({key:m[1],label:m[2]}));
 assert(modules.length>=52,"Feature registry unexpectedly shrank");
 assert.equal(new Set(modules.map(m=>m.key)).size,modules.length);
 assert.equal(await directory.locator("[data-workspace-group]").count(),12,"Owner workspace must have 12 groups");
 // Startup route can already belong to Inventory. Navigate explicitly to a
 // known route, then exercise the toggle in both directions.
 await directory.getByRole("textbox",{name:"Search tools"}).fill("dashboard");
 await directory.locator('[data-tool-key="dashboard"]').click();
 await directory.locator('#page[data-current-page="dashboard"]').waitFor();
 const inventoryGroup=directory.locator("[data-workspace-group=inventory]");
 await directory.waitForFunction(()=>document.querySelector("[data-workspace-group=inventory]")?.getAttribute("aria-expanded")==="false");
 await inventoryGroup.click();
 await directory.waitForFunction(()=>document.querySelector("[data-workspace-group=inventory]")?.getAttribute("aria-expanded")==="true");
 await directory.getByRole("button",{name:"Stock Adjustment",exact:true}).waitFor({state:"visible"});
 await inventoryGroup.click();
 await directory.waitForFunction(()=>document.querySelector("[data-workspace-group=inventory]")?.getAttribute("aria-expanded")==="false");
 assert.equal(await directory.getByRole("button",{name:"Stock Adjustment",exact:true}).count(),0);
 console.log("PASS 12-category owner navigation, group expansion and collapse");
 const search=directory.getByRole("textbox",{name:"Search tools"});
 // Observe the actual DOM during navigation, including transient loader flashes.
 await directory.evaluate(()=>{const w=window; w.__dsRouteLoaderFlashes=0; new MutationObserver(()=>{if(document.querySelector("#page")?.textContent?.includes("Loading view..."))w.__dsRouteLoaderFlashes++;}).observe(document.body,{subtree:true,childList:true,characterData:true});});
 for(const module of modules){
   await search.fill(module.key);
   await directory.locator('[data-tool-key="'+module.key+'"]').click();
   await directory.locator('#page[data-current-page="'+module.key+'"]').waitFor();
   await directory.waitForFunction(()=>!document.querySelector("#page")?.textContent?.includes("Loading view..."));
   assert((await directory.locator("#page").innerText()).trim().length>0,"Empty module "+module.key);
   console.log("PASS module render:",module.key);
 }
 assert.equal(await directory.evaluate(()=>window.__dsRouteLoaderFlashes),0,"Navigation displayed a blocking route loader");
 console.log("PASS no transient route loader across registered owner modules");
 console.log("PASS registered owner modules:",modules.length);
 await search.fill("appearanceStudio");
 await directory.locator('[data-tool-key="appearanceStudio"]').click();
 await directory.getByRole("button",{name:/Cinematic 3D/}).click();
 assert.equal(await directory.locator("html").getAttribute("data-retail-motion"),"cinematic");
 await directory.getByRole("button",{name:/Minimal motion/}).click();
 assert.equal(await directory.locator("html").getAttribute("data-retail-motion"),"quiet");
 await search.fill("dashboard");await directory.locator('[data-tool-key="dashboard"]').click();
 await directory.locator(".retail-hero-dashboard .retail-phone").waitFor();
 await directory.getByRole("button",{name:"Customize dashboard",exact:true}).click();
 await directory.getByRole("button",{name:"Hide Active Repairs",exact:true}).click();
 await directory.getByRole("button",{name:"Done",exact:true}).click();
 assert.equal(await directory.locator("[data-metric-id=repairs]").count(),0);
 await directory.getByRole("button",{name:"Customize dashboard",exact:true}).click();
 await directory.getByRole("button",{name:"Reset layout",exact:true}).click();
 await directory.getByRole("button",{name:"Done",exact:true}).click();
 assert.equal(await directory.locator("[data-metric-id=repairs]").count(),1);
 console.log("PASS dashboard metric customization and reset");
 await directory.getByRole("button",{name:"Aaj ki sales",exact:true}).click();
 await directory.locator(".retail-copilot-answer").waitFor();
 await directory.getByRole("button",{name:"Sales forecast",exact:true}).click();
 await directory.getByText("Insufficient recent sales history.",{exact:false}).waitFor();
 await search.fill("sell");await directory.locator('[data-tool-key="sell"]').click();
 await directory.getByRole("button",{name:"Customer display",exact:true}).click();
 await directory.getByRole("dialog",{name:"Customer cart display"}).waitFor();
 await directory.getByRole("button",{name:"Close customer display"}).click();
 await directory.getByRole("button",{name:"Offer studio"}).click();
 await directory.getByRole("button",{name:"Apply reviewed offer"}).waitFor();
 assert.equal(await directory.getByRole("button",{name:"Apply reviewed offer"}).isDisabled(),true);
 await search.fill("dashboard");await directory.locator('[data-tool-key="dashboard"]').click();
 console.log("PASS business copilot, forecast history gate, customer display and empty-cart offer guard");
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
   // Minifiers may shorten #ffffff to #fff or emit named colors.
   // Compare the actual rendered RGB against the authored palette, not the
   // serialization of a custom property.
   const palette=readFileSync("styles/themes.css","utf8");
   const selector='[data-theme="'+id+'"]'+(mode==="Light"?'[data-mode="light"]':'');
   const start=palette.indexOf(selector+" {");
   assert(start>=0,"Missing authored palette "+id+"/"+mode);
   const block=palette.slice(start,palette.indexOf("}",start));
   const names=["canvas","surface","ink","brand","accent"];
   const expected=names.map(k=>{const m=block.match(new RegExp("--"+k+"\\s*:\\s*([^;]+)"));assert(m,"Missing "+k);return m[1].trim();});
   const verified=await directory.evaluate(({names,expected})=>{
    const root=document.documentElement,style=getComputedStyle(root);
    const probe=document.createElement("span");document.body.append(probe);
    const rgb=value=>{if(!value||!CSS.supports("color",value))return null;probe.style.color=value;return getComputedStyle(probe).color;};
    const result=names.map((name,i)=>({name,raw:style.getPropertyValue("--"+name).trim(),actual:rgb(style.getPropertyValue("--"+name).trim()),expected:rgb(expected[i])}));
    probe.remove();return result;
   },{names,expected});
   for(const token of verified)assert(token.actual&&token.actual===token.expected,"Palette mismatch "+id+"/"+mode+": "+JSON.stringify(token));
   await directory.screenshot({path:"visual-review/theme-"+id+"-"+mode.toLowerCase()+".png",animations:"disabled"});
   console.log("PASS rendered palette:",id,mode,JSON.stringify(verified.map(v=>v.actual)));
  }
 }
 console.log("PASS all 22 light/dark palettes and global tool search");
 await search.fill("products");await directory.locator('[data-tool-key="products"]').click();
 await directory.screenshot({path:"visual-review/windows-catalog.png",animations:"disabled"});
 await directory.getByRole("textbox",{name:"Search inventory"}).fill("zzzz-ci-no-matching-product");
 await directory.getByText("No matching products. Try another search or reset filters.").waitFor();
 await directory.getByRole("button",{name:"Reset filters"}).click();
 assert.equal(await directory.getByRole("textbox",{name:"Search inventory"}).inputValue(),"");
 console.log("PASS inventory search and filter reset");
 // Exercise real rendered pagination with synthetic local inventory, not production data.
 const large=await browser.newPage({viewport:{width:1440,height:900}});
 const largeTimings={};
 large.on("pageerror",e=>errors.push(e.message));
 await large.goto(url,{waitUntil:"domcontentloaded"});
 await large.getByText("Owner Confidential Area",{exact:true}).first().click();
 await setupLocalOwner(large);
 const fixtureInfo=await large.evaluate(()=>{
  const key=localStorage.getItem("dsmdh_cache_v4")?"dsmdh_cache_v4":"dsmdh_db_v2";
  const db=JSON.parse(localStorage.getItem(key)||"{}");
  db.products=Array.from({length:10000},(_,i)=>({id:"ci-large-"+i,name:"CI Product "+String(i).padStart(5,"0"),category:"Chargers & Cables",brand:"Synthetic",sku:"CI-LARGE-"+i,photo:"",purchasePrice:10,pendingCost:false,sellingPrice:20,stock:5,minStock:1,warrantyEnabled:false,warrantyMonths:0,requireCustomerDetails:false,supplier:"",notes:"",compatibleModels:[],createdAt:"2026-01-01",updatedAt:"2026-01-01",units:[]}));
  const raw=JSON.stringify(db);
  // Use the real active cache key; duplicating a large fixture into legacy storage would artificially exceed quota.
  localStorage.removeItem(key==="dsmdh_cache_v4"?"dsmdh_db_v2":"dsmdh_cache_v4");
  localStorage.setItem(key,raw);
  return {products:db.products.length,serializedBytes:new TextEncoder().encode(raw).length};
 });
 const largeStart=performance.now();
 await large.reload({waitUntil:"domcontentloaded"});
 await large.getByText("Owner Confidential Area",{exact:true}).first().click();
 await large.getByPlaceholder("Enter Owner Device PIN").fill("5826");
 await large.getByRole("button",{name:"Unlock",exact:true}).click();
 await large.getByRole("textbox",{name:"Search tools"}).fill("products");
 await large.locator('[data-tool-key="products"]').click();
 await large.locator('#page[data-current-page="products"]').waitFor();
 const nav=large.getByRole("navigation",{name:"Inventory pages"});
 await nav.waitFor();
 largeTimings.reloadUnlockAndInventoryMs=Math.round(performance.now()-largeStart);
 assert.equal(await large.locator(".product-card-grid .product-card").count(),48);
 const lastStart=performance.now();
 await nav.getByRole("button",{name:"Last",exact:true}).click();
 assert.equal(await large.locator(".product-card-grid .product-card").count(),16);
 largeTimings.lastInventoryPageMs=Math.round(performance.now()-lastStart);
 const searchStart=performance.now();
 await large.getByRole("textbox",{name:"Search inventory"}).fill("CI Product 09999");
 await large.waitForFunction(()=>document.querySelectorAll(".product-card-grid .product-card").length===1);
 assert.equal(await large.locator(".product-card-grid .product-card").count(),1);
 const foundName=large.locator(".product-card-grid .product-card .product-card-name");
 await foundName.scrollIntoViewIfNeeded();
 await foundName.waitFor({state:"visible"});
 assert.equal(await foundName.innerText(),"CI Product 09999");
 largeTimings.exactNameSearchMs=Math.round(performance.now()-searchStart);
 const skuStart=performance.now();
 await large.getByRole("textbox",{name:"Search inventory"}).fill("CI-LARGE-9999");
 await large.waitForFunction(()=>document.querySelectorAll(".product-card-grid .product-card").length===1&&document.querySelector(".product-card-grid .product-card-name")?.textContent==="CI Product 09999");
 assert.equal(await foundName.innerText(),"CI Product 09999");
 largeTimings.exactSkuSearchMs=Math.round(performance.now()-skuStart);
 await large.getByRole("button",{name:"Reset filters"}).click();
 await nav.waitFor();
 assert.equal(await large.locator(".product-card-grid .product-card").count(),48);
 await large.getByRole("textbox",{name:"Search tools"}).fill("sell");
 await large.locator('[data-tool-key="sell"]').click();
 await large.getByRole("navigation",{name:"POS catalog pages"}).waitFor();
 assert.equal(await large.getByRole("button",{name:"+ Add to Bill",exact:true}).count(),60);
 await large.getByRole("navigation",{name:"POS catalog pages"}).getByRole("button",{name:"Last",exact:true}).click();
 assert.equal(await large.getByRole("button",{name:"+ Add to Bill",exact:true}).count(),40);
 const runtime=await large.evaluate(()=>({domNodes:document.querySelectorAll("*").length,heapBytes:performance.memory?.usedJSHeapSize??null}));
 writeFileSync("visual-review/large-catalog-performance.json",JSON.stringify({...fixtureInfo,timingsMs:largeTimings,runtime,environment:"CI Chromium desktop; synthetic local data; not native-device memory"},null,2));
 await large.close();
 console.log("PASS real rendered inventory/POS pagination, full-catalog search and page reset (10,000 synthetic products)",largeTimings);

 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 mobile.on("pageerror",e=>errors.push(e.message));
 await mobile.goto(url,{waitUntil:"domcontentloaded"});
 await mobile.getByText("Owner Confidential Area",{exact:true}).first().click();
 await mobile.screenshot({path:"visual-review/android-login.png",animations:"disabled"});
 await setupLocalOwner(mobile);
 await testCalculator(mobile,true);
 await mobile.getByRole("button",{name:"More",exact:true}).click();
 const mobileSearch=mobile.getByRole("textbox",{name:"Search tools"});
 await mobileSearch.fill("backup");
 await mobile.getByRole("button",{name:"Backup & Restore",exact:true}).first().click();
 await mobile.waitForFunction(()=>!document.querySelector("#sidebar")?.classList.contains("mobile-open"));
 const sizes=await mobile.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,tab:document.querySelector(".bottom-tab-bar")?.getBoundingClientRect().height||0}));
 assert(sizes.scroll<=sizes.width+1,"Mobile page horizontal overflow");
 assert(sizes.tab>=48,"Mobile navigation touch target too small");
 console.log("PASS responsive mobile drawer, module search, navigation and viewport");
 for(const [key,label] of [["dashboard","dashboard"],["sell","billing"],["products","catalog"],["appearanceStudio","appearance"]]){
   await mobile.getByRole("button",{name:"Open global tool search"}).click();
   await mobile.getByRole("textbox",{name:"Find a tool"}).fill(key);
   await mobile.locator('[data-command-key="'+key+'"]').click();
   await mobile.locator('#page[data-current-page="'+key+'"]').waitFor();
   await mobile.waitForFunction(()=>!document.querySelector("#page")?.textContent?.includes("Loading view..."));
   await mobile.waitForFunction(()=>document.querySelector("#page").scrollLeft===0&&document.querySelector("#page").scrollTop===0);
   const pageBounds=await mobile.locator("#page").boundingBox();
   const sections=await mobile.locator("#page .section").evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().width>0).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));
   assert(sections.every(r=>r.left>=pageBounds.x-2&&r.right<=pageBounds.x+pageBounds.width+2),"Clipped mobile section: "+key);
   assert(await mobile.getByText("Local only",{exact:true}).count()>0,"Local device must not claim cloud sync");
   const geometry=await mobile.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,page:document.querySelector("#page").getBoundingClientRect().height}));
   assert(geometry.scroll<=geometry.width+1&&geometry.page>150,"Mobile layout issue "+key+" "+JSON.stringify(geometry));
   await mobile.screenshot({path:"visual-review/android-"+label+".png",animations:"disabled"});
 }
 // Every registered owner route must be reachable at the Android emulator's
 // compact 320px viewport, in both light and dark, without a blank section.
 const mobileRouteAudit=[];
 await mobile.setViewportSize({width:320,height:640});
 for(const mode of ["Light","Dark"]){
   await mobile.getByRole("button",{name:"Open global tool search"}).click();
   await mobile.getByRole("textbox",{name:"Find a tool"}).fill("appearanceStudio");
   await mobile.locator('[data-command-key="appearanceStudio"]').click();
   await mobile.getByRole("button",{name:mode,exact:true}).click();
   assert.equal(await mobile.locator("html").getAttribute("data-mode"),mode.toLowerCase());
   for(const mod of modules){
     await mobile.getByRole("button",{name:"Open global tool search"}).click();
     await mobile.getByRole("textbox",{name:"Find a tool"}).fill(mod.key);
     await mobile.locator('[data-command-key="'+mod.key+'"]').click();
     await mobile.locator('#page[data-current-page="'+mod.key+'"]').waitFor();
     await mobile.waitForFunction(()=>!document.querySelector("#page")?.textContent?.includes("Loading view..."));
     const result=await mobile.evaluate(()=>{const p=document.querySelector("#page");const box=p.getBoundingClientRect();return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,pageWidth:box.width,pageHeight:box.height,text:(p.innerText||"").trim().length};});
     assert(result.text>0&&result.pageHeight>80&&result.pageWidth>0&&result.scroll<=result.width+1,"Compact Android module render/viewport failure: "+mod.key+"/"+mode+" "+JSON.stringify(result));
     mobileRouteAudit.push({key:mod.key,mode,...result});
   }
   await mobile.getByRole("button",{name:"Open global tool search"}).click();
   await mobile.getByRole("textbox",{name:"Find a tool"}).fill("dashboard");
   await mobile.locator('[data-command-key="dashboard"]').click();
   await mobile.locator('#page[data-current-page="dashboard"]').waitFor();
   await mobile.screenshot({path:"visual-review/android-compact-dashboard-"+mode.toLowerCase()+".png",animations:"disabled"});
 }
 writeFileSync("visual-review/compact-mobile-routes.json",JSON.stringify(mobileRouteAudit,null,2));
 console.log("PASS compact Android owner route renders:",mobileRouteAudit.length);
 for(const key of ["dashboard","sell"]){
  await search.fill(key);await directory.locator('[data-tool-key="'+key+'"]').click();
  await directory.locator('#page[data-current-page="'+key+'"]').waitFor();
  await directory.screenshot({path:"visual-review/windows-"+key+".png",animations:"disabled"});
 }
 writeFileSync("visual-review/summary.json",JSON.stringify({moduleCount:modules.length,paletteCount:ids.length*2,mobileViewport:"390x844",desktopViewport:"1440x900",note:"Synthetic local data; native hardware not tested."},null,2));
 assert.deepEqual(errors,[],"Uncaught browser errors");
 console.log("PASS production UI boot, local-mode entry, local owner/staff entry and inventory/POS navigation");
}finally{await browser?.close();apiServer?.kill();server.kill();}
