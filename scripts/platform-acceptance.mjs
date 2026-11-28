import {chromium} from "playwright";
import {execFileSync,spawn} from "node:child_process";
import {mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import assert from "node:assert/strict";
const host="https://dsmdh-ci.invalid",shop="11111111-1111-4111-8111-111111111111";
const ids={manager:"22222222-2222-4222-8222-222222222222",staff:"33333333-3333-4333-8333-333333333333"};
const results=[];
const navSource=readFileSync("src/components/Sidebar.tsx","utf8");
const modules=[...navSource.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(m=>m[1]);
mkdirSync("visual-review/platforms",{recursive:true});
const state={products:[],settings:{shopName:"CI Synthetic Shop",setupWizardDismissed:true}};
const token=role=>["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",Buffer.from(JSON.stringify({sub:ids[role],aud:"authenticated",role:"authenticated",exp:Math.floor(Date.now()/1000)+3600})).toString("base64url"),"ci-only-signature"].join(".");
const user=role=>({id:ids[role],aud:"authenticated",role:"authenticated",email:role+"@staff.dsmdh.internal",app_metadata:{provider:"email",providers:["email"]},user_metadata:{},created_at:"2026-01-01T00:00:00Z"});
const profile=(role,enabled=true)=>({id:ids[role],email:user(role).email,full_name:"CI "+role,staff_name:"CI "+role,staff_login_id:role,store_id:shop,role,access_enabled:enabled,access_mode:"no_restriction",access_expires_at:null,access_granted_at:null,visibility_from:null,force_logout_at:null});
const policy={policy:{allowed_sections:["sell","products","photoFinder","lowstock","salesToday"],daily_start:null,daily_end:null}};
const browser=await chromium.launch({headless:true});
try{
 for(const [variant,platform,port] of [["full","windows",4191],["mobile","mobile-android",4192]]){
  const dir="dist-ci-"+variant,url="http://127.0.0.1:"+port;
  execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build","--outDir",dir],{stdio:"inherit",env:{...process.env,VITE_SUPABASE_URL:host,VITE_SUPABASE_PUBLISHABLE_KEY:"synthetic-test-public-key",VITE_APP_VARIANT:variant,VITE_APP_PLATFORM:platform,VITE_APP_VERSION:"0.0.0-ci-only",VITE_APP_BUILD:"1"}});
  const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--outDir",dir,"--host","127.0.0.1","--port",String(port),"--strictPort"],{stdio:"inherit"});
  try{
   let ready=false;for(let i=0;i<50;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert(ready);
   for(const role of ["staff","manager"]){
    const mobile=variant==="mobile";
    const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:"block"});
    let signInCount=0,hasPin=false,disabled=false;const unexpected=[],errors=[],rpcCalls=[];
    const p=await ctx.newPage();p.on("pageerror",e=>errors.push(e.message));
    // Fail-safe isolation: every non-local request is intercepted, no real database,
    // credential, provider, device registration or external notification can be touched.
    await ctx.route("**/*",async route=>{
     const req=route.request(),u=new URL(req.url());
     if(u.origin===url)return route.continue();
     if(u.origin!==host)return route.abort();
     const headers={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS","content-type":"application/json"};
     const json=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
     if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
     if(u.pathname==="/auth/v1/token"){
      signInCount++;
      const b=req.postDataJSON();
      if(b?.password!=="CI-synthetic-only")return json({code:"invalid_credentials",msg:"Invalid login credentials"},400);
      return json({access_token:token(role),token_type:"bearer",expires_in:3600,refresh_token:"fixture-refresh",user:user(role)});
     }
     if(u.pathname==="/auth/v1/user")return json(user(role));
     if(u.pathname==="/auth/v1/logout")return route.fulfill({status:204,headers});
     if(u.pathname==="/rest/v1/profiles")return json([profile(role,!disabled)]);
     if(u.pathname==="/rest/v1/store_state")return json([{state,version:1,store_id:shop}]);
     if(u.pathname.startsWith("/rest/v1/rpc/")){
      const name=u.pathname.split("/").pop();rpcCalls.push(name);
      if(name==="current_account_allowed"||name==="register_staff_session")return json(!disabled);
      if(name==="get_my_staff_access_policy")return json(policy);
      if(name==="get_own_pin_status")return json({hasPin,revision:hasPin?"fixture-r1":"fixture-r0",lockedUntil:null});
      if(name==="change_my_pin"){const b=req.postDataJSON();if(role!=="manager"||b?.p_new_pin!=="5826"||hasPin)return json({ok:false});hasPin=true;return json({ok:true,revision:"fixture-r1"});}
      if(name==="verify_own_pin")return json({ok:req.postDataJSON()?.p_pin==="5826",revision:"fixture-r1"});
      if(name==="load_scoped_store_state")return json({state,version:1,storeId:shop});
      if(name==="touch_staff_last_active"||name==="touch_staff_offline_download")return json(null);
      // Unimplemented RPCs must fail explicitly; rendered module coverage
      // does not imply its real provider or write path succeeded.
      return json({code:"CI_UNIMPLEMENTED",message:"Synthetic backend does not implement this operation"},503);
     }
     if(u.pathname.startsWith("/rest/v1/")&&req.method()==="GET")return json([]);
     if(u.pathname.startsWith("/functions/v1/"))return json({error:"External providers disabled in fixture"},503);
     unexpected.push(req.method()+" "+u.pathname);return json({error:"Unexpected fixture request"},503);
    });
    try{
     await p.goto(url+"?page=loanTracker",{waitUntil:"domcontentloaded"});
     if(!mobile)await p.getByText("Login (ID / Password)",{exact:true}).click();
     const login=p.locator("#staff-gate-login-id"),password=p.locator("#staff-gate-password"),submit=p.getByRole("button",{name:"Login",exact:true});
     await login.waitFor();
     await submit.click();await p.getByRole("alert").getByText("Login ID aur Password dono bharo.").waitFor();assert.equal(signInCount,0);
     await login.fill(role);await password.fill("invalid");await submit.click();await p.getByText("Galat Login ID ya Password.",{exact:true}).waitFor();assert.equal(signInCount,1);
     await password.fill("CI-synthetic-only");await submit.click();await p.locator("#app").waitFor({timeout:30000});
     assert.equal(signInCount,2);
     assert.equal(await p.locator("#staff-gate-password").count(),0);
     // Operate the actual POS in each platform/role, with the network
     // isolated. Verify a paise-valued service, quantity, and removal.
     await p.getByRole("button",{name:"Open global tool search"}).click();
     await p.getByRole("textbox",{name:"Find a tool"}).fill("sell");
     await p.locator('[data-command-key="sell"]').click();
     await p.locator('#page[data-current-page="sell"]').waitFor();
     await p.getByRole("button",{name:"+ Custom Service",exact:true}).click();
     const service=p.getByRole("dialog",{name:"Quick Miscellany & Service Key"});
     await service.getByRole("textbox",{name:/Service \/ Job Title/}).fill("CI platform service");
     await service.getByLabel("Customer Charge (₹) *",{exact:true}).fill("49.75");
     assert.equal(await service.locator("form").evaluate(form=>form.checkValidity()),true);
     await service.getByRole("button",{name:/Add to Cart/}).click();
     const line=p.locator(".cart-line").filter({hasText:"CI platform service"});
     await line.waitFor();
     assert.equal(await line.getByRole("spinbutton",{name:"Unit price for CI platform service"}).inputValue(),"49.75");
     await line.getByRole("button",{name:"Increase quantity of CI platform service"}).click();
     assert.equal(await line.locator(".qtyval").innerText(),"2");
     await line.getByRole("button",{name:"Decrease quantity of CI platform service"}).click();
     assert.equal(await line.locator(".qtyval").innerText(),"1");
     await line.getByRole("button",{name:"Remove CI platform service from cart"}).click();
     await line.waitFor({state:"detached"});
     results.push({platform,role,feature:"service cart with paise, increment/decrement and removal",status:"functional"});
     console.log("PASS actual platform service cart "+platform+"/"+role);

     if(role==="staff"){
      await p.waitForFunction(()=>document.querySelector("#page")?.getAttribute("data-current-page")!=="loanTracker");
      if(mobile){
       const nav=p.getByRole("navigation",{name:"Primary navigation"});
       assert.deepEqual(await nav.getByRole("button").allTextContents(),["Sell","Add Stock","Stock","Alerts","Sales"]);
       for(const [label,key] of [["Sell","sell"],["Stock","products"],["Alerts","lowstock"],["Sales","salesToday"]]){
        await nav.getByRole("button",{name:label,exact:true}).click();await p.locator('#page[data-current-page="'+key+'"]').waitFor();
        results.push({platform,role,feature:key,status:"rendered"});
       }
       await nav.getByRole("button",{name:"Add Stock",exact:true}).click();
       await p.getByText(/Add New Item|Add New Product|Add Product/).first().waitFor({timeout:10000});
       assert.equal(await p.getByText(/Original \/ Purchase Price|Confidential Price/,{exact:false}).count(),0,"Staff stock form exposed owner price fields");
       await p.screenshot({path:"visual-review/platforms/android-staff-stock.png",animations:"disabled"});
      }else{
       const search=p.getByRole("textbox",{name:"Search tools"});
       for(const key of ["sell","products","photoFinder","lowstock","salesToday"]){
        await search.fill(key);await p.locator('[data-tool-key="'+key+'"]').click();await p.locator('#page[data-current-page="'+key+'"]').waitFor();results.push({platform,role,feature:key,status:"rendered"});
       }
       await search.fill("loanTracker");assert.equal(await p.locator('[data-tool-key="loanTracker"]').count(),0);
      }
     }else{
      if(mobile){
       await p.locator('#page[data-current-page="sell"]').waitFor();
       await p.getByRole("button",{name:"Menu kholo"}).click();
       await p.getByTitle("Switch to Pro Mode (needs fingerprint/PIN)").click();
       await p.getByText("Create personal PIN",{exact:true}).waitFor();
       await p.getByPlaceholder("Owner authentication required").fill("5826");
       await p.getByLabel("Confirm personal PIN").fill("5826");
       await p.getByRole("button",{name:"Switch to Pro",exact:true}).click();
       await p.getByTitle("Switch back to Lite Mode").waitFor();assert(hasPin);assert(rpcCalls.includes("change_my_pin"));
       await p.getByRole("button",{name:"Menu kholo"}).click();
       await p.getByTitle("Switch back to Lite Mode").click();
       await p.locator('#page[data-current-page="sell"]').waitFor();
       assert.equal(await p.getByRole("navigation",{name:"Primary navigation"}).getByRole("button").count(),2);
       await p.getByRole("button",{name:"Menu kholo"}).click();
       await p.getByTitle("Switch to Pro Mode (needs fingerprint/PIN)").click();
       await p.getByPlaceholder("Owner authentication required").fill("5826");
       await p.getByRole("button",{name:"Switch to Pro",exact:true}).click();await p.getByTitle("Switch back to Lite Mode").waitFor();
       assert(rpcCalls.includes("verify_own_pin"));
      }
      // Actual production-variant UI navigation, not a desktop build
      // merely resized to phone width. Mock data only, no live writes.
      for(const key of modules){
       const trigger=p.getByRole("button",{name:"Open global tool search"});
       if(mobile&&await p.locator("#sidebar").evaluate(el=>el.classList.contains("mobile-open")))await p.keyboard.press("Escape").catch(()=>{});
       await trigger.click();
       await p.getByRole("textbox",{name:"Find a tool"}).fill(key);
       await p.locator('[data-command-key="'+key+'"]').click();
       await p.locator('#page[data-current-page="'+key+'"]').waitFor();
       const geom=await p.evaluate(()=>({w:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,text:document.querySelector("#page").innerText.trim().length}));
       assert(geom.text>0&&geom.scroll<=geom.w+1,"Broken platform route "+platform+"/"+key+" "+JSON.stringify(geom));
       results.push({platform,role,feature:key,status:"rendered"});
      }
      await p.screenshot({path:"visual-review/platforms/"+platform+"-manager.png",animations:"disabled"});
     }
     assert.deepEqual(errors,[],"Uncaught errors for "+platform+"/"+role);
     console.log("PASS variant "+platform+" "+role+" login and route coverage; mocked cloud only");
    }finally{await ctx.close();writeFileSync("visual-review/platforms/results.json",JSON.stringify(results,null,2));}
   }
  }finally{server.kill();rmSync(dir,{recursive:true,force:true});}
 }
}finally{await browser.close();}
