import {describe,it,expect} from "vitest";
import type {Database} from "../types";
import {applyProductPhotoMigration,clearConfirmedDeletedPhotos,stalePhotoEligible} from "./productPhotoIntegrity";
const state=(photo:string,photos:string[])=>({products:[{id:"p",photo,photos,stock:0,outOfStockSince:"2025-01-01"}],sales:[{id:"new-sale"}],settings:{name:"current"}} as unknown as Database);
describe("asynchronous media snapshot integrity",()=>{
 it("does not overwrite a newer photo or newer unrelated records",()=>{const db=state("https://new",["https://new","data:back"]);expect(applyProductPhotoMigration(db,"p",0,"data:old","https://old-upload")).toBeNull();const next=applyProductPhotoMigration(db,"p",1,"data:back","https://back")!;expect(next.products[0].photos).toEqual(["https://new","https://back"]);expect(next.sales).toBe(db.sales);expect(db.products[0].photos).toEqual(["https://new","data:back"]);});
 it("only removes the exact acknowledged URL",()=>{const db=state("https://new",["https://new","https://old-back"]);const next=clearConfirmedDeletedPhotos(db,[{productId:"p",url:"https://old-back"},{productId:"p",url:"https://old-front"}]);expect(next.products[0].photo).toBe("https://new");expect(next.products[0].photos).toEqual(["https://new"]);expect(next.sales).toBe(db.sales);});
 it("requires finite zero stock and valid old timestamp",()=>{const p=state("x",[]).products[0];expect(stalePhotoEligible(p,Date.parse("2026-01-01"))).toBe(true);expect(stalePhotoEligible({...p,stock:1},Date.parse("2026-01-01"))).toBe(false);expect(stalePhotoEligible({...p,stock:NaN},Date.parse("2026-01-01"))).toBe(false);});
});
