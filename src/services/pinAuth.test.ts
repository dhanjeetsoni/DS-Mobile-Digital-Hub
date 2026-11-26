import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));
vi.mock("./supabaseClient", () => ({supabase:{auth:{getSession:mocks.getSession},rpc:mocks.rpc}}));
import { verifyPin, isBiometricEnabled } from "./pinAuth";
const profile = "test-profile";
describe("offline PIN retry protection",()=>{
  let data: Map<string,string>;
  beforeEach(()=>{
    vi.resetAllMocks();
    data = new Map();
    vi.stubGlobal("localStorage",{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,v:string)=>data.set(key,v),removeItem:(key:string)=>data.delete(key)});
    vi.stubGlobal("navigator",{onLine:false});
    vi.stubGlobal("crypto",webcrypto);
    mocks.getSession.mockResolvedValue({data:{session:{user:{id:profile}}}});
    data.set("dsmdh_pin_v2_"+profile,JSON.stringify({hash:"not-a-match",salt:"test-salt",revision:"r1"}));
    data.set("dsmdh_pin_status_v2_"+profile,JSON.stringify({hasPin:true,revision:"r1",lockedUntil:null}));
    data.set("dsmdh_biometric_enabled_v1_"+profile,"1");
  });
  afterEach(()=>vi.unstubAllGlobals());
  it("persists a lockout after three failed offline PIN attempts",async()=>{
    expect(isBiometricEnabled(profile)).toBe(true);
    for(let i=0;i<3;i++) expect(await verifyPin(profile,"9999")).toBe(false);
    const attempts=JSON.parse(data.get("dsmdh_pin_attempts_v1_"+profile)!);
    expect(attempts.count).toBe(3);
    expect(attempts.lockUntil).toBeGreaterThan(Date.now());
    expect(await verifyPin(profile,"9999")).toBe(false);
    expect(JSON.parse(data.get("dsmdh_pin_attempts_v1_"+profile)!).count).toBe(3);
    expect(isBiometricEnabled(profile)).toBe(false);
  });
});
