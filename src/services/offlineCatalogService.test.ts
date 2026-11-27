import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(), range: vi.fn(), getSession: vi.fn(),
}));
vi.mock("./supabaseClient", () => ({ supabase: { from: mocks.from, auth: { getSession: mocks.getSession } } }));
import { downloadFullCatalogForOffline, getCachedOfflineCatalog, getOfflineCatalogMeta, clearOfflineCatalogCache } from "./offlineCatalogService";
const owner = { storeId: "shop-1", profileId: "owner-1" };
const staff = { storeId: "shop-1", profileId: "staff-1" };
const product = (n: number) => ({ id: String(n), model: "Product " + n, category: "Accessories", selling_price: 100, stock_qty: 1, cost_price: 45 });
describe("account-scoped offline catalog", () => {
  let local: Map<string, string>;
  beforeEach(() => {
    vi.resetAllMocks();
    local = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string,v: string) => local.set(k,v), removeItem: (k: string) => local.delete(k) });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: owner.profileId } } }, error: null });
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: mocks.range };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain);
    mocks.from.mockReturnValue(chain);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("paginates and isolates records and metadata by account", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({length:500}, (_, i) => product(i)), error: null })
      .mockResolvedValueOnce({ data: [product(500)], error: null });
    expect(await downloadFullCatalogForOffline(owner)).toMatchObject({success: true,itemCount:501});
    expect(mocks.range.mock.calls).toEqual([[0,499],[500,999]]);
    expect(mocks.from.mock.calls.every(([name]) => name === "products_staff_view")).toBe(true);
    expect(getOfflineCatalogMeta(owner).itemCount).toBe(501);
    expect(getCachedOfflineCatalog(owner)?.[0]?.purchasePrice).toBeNull();
    expect(getCachedOfflineCatalog(owner)?.[0]?.confidentialPrice).toBeNull();
    expect(getCachedOfflineCatalog(owner)?.[0]).not.toHaveProperty("costPrice");
    expect(getCachedOfflineCatalog(staff)).toBeNull();
    expect(getOfflineCatalogMeta(staff).status).toBe("empty");
    expect(getCachedOfflineCatalog({...owner, storeId:"other"})).toBeNull();
  });
  it("keeps the last valid cache on failed refresh", async () => {
    mocks.range.mockResolvedValueOnce({data:[product(1)],error:null});
    expect((await downloadFullCatalogForOffline(owner)).success).toBe(true);
    mocks.range.mockResolvedValueOnce({data:null,error:{message:"Connection failed"}});
    expect(await downloadFullCatalogForOffline(owner)).toMatchObject({success:false,message:"Connection failed"});
    expect(getOfflineCatalogMeta(owner).itemCount).toBe(1);
    expect(mocks.from.mock.calls.every(([name]) => name === "products_staff_view")).toBe(true);
  });
  it("rejects an account switch during download", async () => {
    mocks.getSession.mockResolvedValueOnce({data:{session:{user:{id:owner.profileId}}},error:null})
      .mockResolvedValueOnce({data:{session:{user:{id:staff.profileId}}},error:null});
    mocks.range.mockResolvedValueOnce({data:[product(1)],error:null});
    expect((await downloadFullCatalogForOffline(owner)).success).toBe(false);
    expect(getCachedOfflineCatalog(owner)).toBeNull();
  });
  it("rejects duplicate IDs across changing pages and preserves the existing cache",async()=>{mocks.range.mockResolvedValueOnce({data:[product(9)],error:null});expect((await downloadFullCatalogForOffline(owner)).success).toBe(true);mocks.range.mockResolvedValueOnce({data:Array.from({length:500},(_,i)=>product(i)),error:null}).mockResolvedValueOnce({data:[product(499)],error:null});expect((await downloadFullCatalogForOffline(owner)).success).toBe(false);expect(getCachedOfflineCatalog(owner)?.length).toBe(1);});
  it("allows a truly empty catalog and clears only the selected scope", async () => {
    mocks.range.mockResolvedValueOnce({data:[],error:null});
    expect(await downloadFullCatalogForOffline(owner)).toMatchObject({success:true,itemCount:0});
    mocks.getSession.mockResolvedValue({data:{session:{user:{id:staff.profileId}}},error:null});
    mocks.range.mockResolvedValueOnce({data:[product(1)],error:null});
    expect((await downloadFullCatalogForOffline(staff)).success).toBe(true);
    clearOfflineCatalogCache(owner);
    expect(getCachedOfflineCatalog(owner)).toBeNull();
    expect(getCachedOfflineCatalog(staff)?.length).toBe(1);
  });
});
