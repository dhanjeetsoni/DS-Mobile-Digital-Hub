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
 assert.deepEqual(errors,[],"Uncaught browser errors");
 console.log("PASS production UI boot, local-mode entry, local owner/staff entry and inventory/POS navigation");
}finally{await browser?.close();server.kill();}
