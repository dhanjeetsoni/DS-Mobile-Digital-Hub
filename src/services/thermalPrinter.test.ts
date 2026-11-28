import {describe,it,expect} from "vitest";import {buildEscPosReceipt,type ReceiptSale} from "./thermalPrinter";
const sale:ReceiptSale={invoiceNo:"CI-TEST",date:"2026-11-27",time:"12:00",payment:"Cash",items:[{name:"Test item",qty:1,price:10.25}],subtotal:10.25,total:10.25,amountPaid:10,dueAmount:.25};
describe("thermal receipt bytes",()=>{it("preserves paise and fractional balance due for both widths",()=>{for(const w of ["58mm","80mm"] as const){const bytes=buildEscPosReceipt({shopName:"Test shop"},sale,w);const text=new TextDecoder().decode(bytes);expect(text).toContain("Rs.10.25");expect(text).toContain("BALANCE DUE");expect(text).toContain("Rs.0.25");expect(Array.from(bytes.slice(0,2))).toEqual([27,64]);}});it("does not inject printer control commands from product names",()=>{const bytes=buildEscPosReceipt({}, {...sale,items:[{name:"Bad\x1b\x70\x00\x07",qty:1,price:10.25}]});expect(Array.from(bytes).filter(n=>n===7)).toHaveLength(0);expect(new TextDecoder().decode(bytes)).not.toContain("\x1bp");});});

import {vi,afterEach} from "vitest";
import {printViaBluetooth,connectBluetoothPrinter,disconnectBluetoothPrinter,isBluetoothPrinterConnected,printViaSerial,disconnectSerialPrinter} from "./thermalPrinter";
afterEach(()=>{disconnectBluetoothPrinter();disconnectSerialPrinter();vi.unstubAllGlobals();});
describe("printer transport acceptance with simulated devices",()=>{
 it("does not interleave receipts; uses default ATT sized writes and prefers acknowledged writes",async()=>{
  const writes:number[][]=[];let unblock!:()=>void;
  const first=new Promise<void>(r=>{unblock=r;});
  const ch={properties:{write:true,writeWithoutResponse:true},writeValueWithResponse:vi.fn(async(b:Uint8Array)=>{writes.push([...b]);if(writes.length===1)await first;}),writeValueWithoutResponse:vi.fn()};
  const gatt={connected:false,connect:vi.fn(async()=>{gatt.connected=true;return gatt;}),disconnect:vi.fn(()=>{gatt.connected=false;}),getPrimaryService:vi.fn(async()=>({getCharacteristics:async()=>[ch]}))};
  vi.stubGlobal("navigator",{bluetooth:{requestDevice:vi.fn(async()=>({name:"CI printer",gatt}))}});
  await connectBluetoothPrinter();
  const data=Uint8Array.from({length:43},(_,i)=>i);
  const printing=printViaBluetooth(data);
  await expect(printViaBluetooth(data)).rejects.toThrow("busy");
  unblock();await printing;
  expect(writes.map(x=>x.length)).toEqual([20,20,3]);expect(writes.flat()).toEqual([...data]);expect(ch.writeValueWithoutResponse).not.toHaveBeenCalled();
 });
 it("disconnects failed BLE discovery and clears uncertain writes without automatic replay",async()=>{
  const ch={properties:{writeWithoutResponse:true},writeValueWithoutResponse:vi.fn(async()=>{throw Error("connection lost");})};
  const gatt={connected:false,connect:vi.fn(async()=>{gatt.connected=true;return gatt;}),disconnect:vi.fn(()=>{gatt.connected=false;}),getPrimaryService:vi.fn(async()=>({getCharacteristics:async()=>[ch]}))};
  const requestDevice=vi.fn(async()=>({gatt}));vi.stubGlobal("navigator",{bluetooth:{requestDevice}});
  await expect(printViaBluetooth(new Uint8Array(41))).rejects.toThrow("partially printed");
  expect(ch.writeValueWithoutResponse).toHaveBeenCalledTimes(1);expect(isBluetoothPrinterConnected()).toBe(false);expect(requestDevice).toHaveBeenCalledTimes(1);
 });
 it("releases and closes failed USB writes and reconnects for the next explicit print",async()=>{
  const releaseLock=vi.fn(),close=vi.fn(async()=>{}),write=vi.fn().mockRejectedValueOnce(Error("USB lost")).mockResolvedValueOnce(undefined);
  const port={open:vi.fn(async()=>{}),close,writable:{getWriter:()=>({write,releaseLock})}};
  const requestPort=vi.fn(async()=>port);vi.stubGlobal("navigator",{serial:{requestPort}});
  await expect(printViaSerial(new Uint8Array([1]))).rejects.toThrow("partially printed");
  expect(close).toHaveBeenCalledTimes(1);expect(releaseLock).toHaveBeenCalledTimes(1);
  await printViaSerial(new Uint8Array([2]));expect(requestPort).toHaveBeenCalledTimes(2);expect(releaseLock).toHaveBeenCalledTimes(2);
 });
});
