import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const port=4179;
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(port),"--strictPort"],{stdio:"inherit",env:process.env});
let browser;
try{
 const url="http://127.0.0.1:"+port;
 let ready=false;
 for(let i=0;i<60;i++){try{const r=await fetch(url);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert(ready,"Production preview did not start");
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(url,{waitUntil:"domcontentloaded"});
 await page.getByText("Owner Confidential Area",{exact:true}).first().waitFor({timeout:30000});
 await page.getByText("Login (ID / Password)",{exact:true}).click();
 await page.getByText("All Products",{exact:true}).first().waitFor({timeout:30000});
 await page.getByText("Sales / New Bill",{exact:true}).first().click();
 await page.getByText("All Products",{exact:true}).first().click();
 await page.getByText("Returns & Exchanges",{exact:true}).first().click();
 await page.getByText("All Products",{exact:true}).first().click();
 assert.deepEqual(errors,[],"Uncaught browser errors");
 console.log("PASS production UI boot, local-mode entry, inventory/POS/returns navigation");
}finally{await browser?.close();server.kill();}
