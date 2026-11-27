import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const assets={"index.html":"text/html","catalog.js":"text/javascript","catalog.css":"text/css"};
const server=createServer(async(req,res)=>{const name=req.url==="/"?"index.html":req.url.slice(1);if(!Object.hasOwn(assets,name)){res.writeHead(404).end();return;}try{res.writeHead(200,{"Content-Type":assets[name]});res.end(await readFile(new URL("../customer-portal/"+name,import.meta.url)));}catch{res.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const root="http://127.0.0.1:"+server.address().port+"/",token="a".repeat(64),nextToken="b".repeat(64);
 let calls=0,mode="public";const errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/customer-share",async route=>{
  const req=route.request();calls++;assert.equal(req.method(),"POST");assert.equal(new URL(req.url()).search,"");const body=req.postDataJSON();assert.equal(body.action,"read_catalog");assert.ok([token,nextToken].includes(body.token));assert.equal(req.headers().referer,undefined);
  const items=Array.from({length:75},(_,i)=>({name:"Product "+String(i).padStart(2,"0"),category:i%2?"Mobile":"Accessory",brand:"Demo",price:100+i,photo:null}));
  items[0].name="<script>not executable</script>";items[0].photo="https://example.invalid/private.png";
  const data=mode==="expired"?{error:"internal diagnostic should never render"}:{shop:"Demo Shop",prices:mode==="public",items:[null,...items]};
  await route.fulfill({status:mode==="expired"?410:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(data)});
 });
 await page.goto(root+"#invalid");await page.getByRole("status").getByText("This catalog link is incomplete or invalid.").waitFor();assert.equal(calls,0);
 await page.goto(root+"#"+token);await page.getByText("75 matching products",{exact:true}).waitFor();assert.equal(await page.locator("article").count(),36);
 assert.equal(await page.locator("article script").count(),0);assert.equal(await page.locator("article img").count(),0);
 await page.getByRole("button",{name:"Next"}).click();assert.equal(await page.locator("#page").innerText(),"2 / 3");
 await page.getByRole("button",{name:"Next"}).click();assert.equal(await page.locator("article").count(),3);
 await page.locator("#search").fill("Product 42");await page.getByText("1 matching products",{exact:true}).waitFor();assert.equal(await page.locator("article h2").innerText(),"Product 42");
 await page.locator("#search").fill("");await page.locator("#category").selectOption("Mobile");await page.getByText("37 matching products",{exact:true}).waitFor();await page.locator("#sort").selectOption("high");assert.equal(await page.locator("article h2").first().innerText(),"Product 73");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator("#category").selectOption("");mode="private";await page.getByRole("button",{name:"Refresh"}).click();await page.getByText("75 matching products",{exact:true}).waitFor();assert.equal(await page.locator("#sort").isDisabled(),true);assert.equal(await page.locator("#sort").inputValue(),"name");assert.equal(await page.locator(".price").first().innerText(),"Contact for price");
 mode="expired";await page.evaluate(t=>location.hash=t,nextToken);await page.getByText("This catalog link has expired or is unavailable.",{exact:true}).waitFor();assert.equal(await page.locator("article").count(),0);assert.equal(await page.locator("#shop").innerText(),"Discover our store");assert.equal(await page.locator("#page").innerText(),"");assert.equal(await page.getByRole("button",{name:"Refresh"}).isEnabled(),true);assert.deepEqual(errors,[]);
 console.log("Storefront mobile browser acceptance passed (mocked provider, no real customer data).");
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
