/**
 * Comprehensive Indian Smartphone Model Catalog & Fast Auto-Suggest Engine
 * Covers the most popular brands and series in Indian retail stores
 * (Vivo, Redmi/Xiaomi, Samsung, Realme, Oppo, OnePlus, Apple, Motorola, Poco, iQOO, Infinix, Tecno, Nothing, Lava)
 */

export interface PhoneModelEntry {
  brand: string;
  model: string;
  aliases?: string[];
  popularity?: number; // Higher number = more common in Indian retail
}

export const POPULAR_PHONE_MODELS: PhoneModelEntry[] = [
  // ==================== VIVO ====================
  // Y Series (High Volume Retail)
  { brand: "Vivo", model: "Vivo Y20", aliases: ["Y20", "V2029"], popularity: 100 },
  { brand: "Vivo", model: "Vivo Y20G", aliases: ["Y20G"], popularity: 95 },
  { brand: "Vivo", model: "Vivo Y20A", aliases: ["Y20A"], popularity: 90 },
  { brand: "Vivo", model: "Vivo Y21", aliases: ["Y21", "V2111"], popularity: 100 },
  { brand: "Vivo", model: "Vivo Y21T", aliases: ["Y21T"], popularity: 90 },
  { brand: "Vivo", model: "Vivo Y22", aliases: ["Y22"], popularity: 95 },
  { brand: "Vivo", model: "Vivo Y16", aliases: ["Y16"], popularity: 98 },
  { brand: "Vivo", model: "Vivo Y02", aliases: ["Y02", "Y02t"], popularity: 88 },
  { brand: "Vivo", model: "Vivo Y17s", aliases: ["Y17s"], popularity: 92 },
  { brand: "Vivo", model: "Vivo Y27", aliases: ["Y27 5G"], popularity: 90 },
  { brand: "Vivo", model: "Vivo Y28 5G", aliases: ["Y28", "Y28 5G"], popularity: 98 },
  { brand: "Vivo", model: "Vivo Y28s 5G", aliases: ["Y28s"], popularity: 92 },
  { brand: "Vivo", model: "Vivo Y200 5G", aliases: ["Y200", "Y200e"], popularity: 99 },
  { brand: "Vivo", model: "Vivo Y200e 5G", aliases: ["Y200e"], popularity: 95 },
  { brand: "Vivo", model: "Vivo Y200 Pro 5G", aliases: ["Y200 Pro"], popularity: 93 },
  { brand: "Vivo", model: "Vivo Y56 5G", aliases: ["Y56"], popularity: 94 },
  { brand: "Vivo", model: "Vivo Y100 5G", aliases: ["Y100", "Y100A"], popularity: 92 },
  { brand: "Vivo", model: "Vivo Y58 5G", aliases: ["Y58"], popularity: 91 },
  { brand: "Vivo", model: "Vivo Y18", aliases: ["Y18", "Y18e"], popularity: 94 },
  { brand: "Vivo", model: "Vivo Y75 5G", aliases: ["Y75"], popularity: 85 },
  { brand: "Vivo", model: "Vivo Y35", aliases: ["Y35"], popularity: 85 },
  { brand: "Vivo", model: "Vivo Y15", aliases: ["Y15s", "Y15c"], popularity: 88 },
  { brand: "Vivo", model: "Vivo Y12", aliases: ["Y12s", "Y12G"], popularity: 88 },
  { brand: "Vivo", model: "Vivo Y91", aliases: ["Y91i", "Y93", "Y95"], popularity: 85 },
  { brand: "Vivo", model: "Vivo Y11", aliases: ["Y11 2019"], popularity: 82 },
  { brand: "Vivo", model: "Vivo Y30", aliases: ["Y30"], popularity: 80 },
  { brand: "Vivo", model: "Vivo Y51", aliases: ["Y51A"], popularity: 80 },
  { brand: "Vivo", model: "Vivo Y19", aliases: ["Y19"], popularity: 80 },
  { brand: "Vivo", model: "Vivo Y33s", aliases: ["Y33T"], popularity: 85 },
  { brand: "Vivo", model: "Vivo Y73", aliases: ["Y73"], popularity: 82 },

  // V Series
  { brand: "Vivo", model: "Vivo V29", aliases: ["V29 5G", "V2250"], popularity: 100 },
  { brand: "Vivo", model: "Vivo V29e", aliases: ["V29e 5G"], popularity: 97 },
  { brand: "Vivo", model: "Vivo V29 Pro", aliases: ["V29 Pro 5G"], popularity: 95 },
  { brand: "Vivo", model: "Vivo V27", aliases: ["V27 5G"], popularity: 98 },
  { brand: "Vivo", model: "Vivo V27 Pro", aliases: ["V27 Pro 5G"], popularity: 95 },
  { brand: "Vivo", model: "Vivo V30", aliases: ["V30 5G"], popularity: 99 },
  { brand: "Vivo", model: "Vivo V30e", aliases: ["V30e 5G"], popularity: 96 },
  { brand: "Vivo", model: "Vivo V30 Pro", aliases: ["V30 Pro 5G"], popularity: 94 },
  { brand: "Vivo", model: "Vivo V40", aliases: ["V40 5G"], popularity: 98 },
  { brand: "Vivo", model: "Vivo V40 Pro", aliases: ["V40 Pro 5G"], popularity: 95 },
  { brand: "Vivo", model: "Vivo V40e", aliases: ["V40e 5G"], popularity: 93 },
  { brand: "Vivo", model: "Vivo V25", aliases: ["V25 5G", "V25 Pro", "V25e"], popularity: 88 },
  { brand: "Vivo", model: "Vivo V23 5G", aliases: ["V23 Pro", "V23e"], popularity: 87 },
  { brand: "Vivo", model: "Vivo V21 5G", aliases: ["V21e"], popularity: 85 },
  { brand: "Vivo", model: "Vivo V20", aliases: ["V20 Pro", "V20 SE"], popularity: 85 },
  { brand: "Vivo", model: "Vivo V19", aliases: ["V19"], popularity: 78 },
  { brand: "Vivo", model: "Vivo V15 Pro", aliases: ["V15"], popularity: 78 },

  // T Series
  { brand: "Vivo", model: "Vivo T2 5G", aliases: ["T2"], popularity: 99 },
  { brand: "Vivo", model: "Vivo T2x 5G", aliases: ["T2x"], popularity: 100 },
  { brand: "Vivo", model: "Vivo T2 Pro 5G", aliases: ["T2 Pro"], popularity: 96 },
  { brand: "Vivo", model: "Vivo T3 5G", aliases: ["T3"], popularity: 99 },
  { brand: "Vivo", model: "Vivo T3x 5G", aliases: ["T3x"], popularity: 99 },
  { brand: "Vivo", model: "Vivo T3 Lite 5G", aliases: ["T3 Lite"], popularity: 95 },
  { brand: "Vivo", model: "Vivo T3 Pro 5G", aliases: ["T3 Pro"], popularity: 94 },
  { brand: "Vivo", model: "Vivo T3 Ultra", aliases: ["T3 Ultra"], popularity: 90 },
  { brand: "Vivo", model: "Vivo T1 5G", aliases: ["T1", "T1 44W", "T1 Pro"], popularity: 90 },

  // X Series
  { brand: "Vivo", model: "Vivo X100", aliases: ["X100 Pro", "X100 Ultra"], popularity: 88 },
  { brand: "Vivo", model: "Vivo X90", aliases: ["X90 Pro"], popularity: 84 },
  { brand: "Vivo", model: "Vivo X80", aliases: ["X80 Pro"], popularity: 80 },

  // ==================== XIAOMI / REDMI ====================
  // Redmi Note Series
  { brand: "Xiaomi", model: "Redmi Note 13 5G", aliases: ["Note 13", "RN13"], popularity: 100 },
  { brand: "Xiaomi", model: "Redmi Note 13 Pro 5G", aliases: ["Note 13 Pro", "RN13 Pro"], popularity: 98 },
  { brand: "Xiaomi", model: "Redmi Note 13 Pro+ 5G", aliases: ["Note 13 Pro Plus", "RN13 Pro+"], popularity: 97 },
  { brand: "Xiaomi", model: "Redmi Note 12 5G", aliases: ["Note 12", "RN12"], popularity: 100 },
  { brand: "Xiaomi", model: "Redmi Note 12 Pro 5G", aliases: ["Note 12 Pro", "RN12 Pro"], popularity: 97 },
  { brand: "Xiaomi", model: "Redmi Note 12 Pro+ 5G", aliases: ["Note 12 Pro+"], popularity: 95 },
  { brand: "Xiaomi", model: "Redmi Note 11", aliases: ["Note 11S", "Note 11 Pro", "Note 11 Pro+"], popularity: 94 },
  { brand: "Xiaomi", model: "Redmi Note 10", aliases: ["Note 10 Pro", "Note 10 Pro Max", "Note 10S"], popularity: 92 },
  { brand: "Xiaomi", model: "Redmi Note 9 Pro", aliases: ["Note 9 Pro Max", "Note 9"], popularity: 88 },
  { brand: "Xiaomi", model: "Redmi Note 8 Pro", aliases: ["Note 8"], popularity: 85 },
  { brand: "Xiaomi", model: "Redmi Note 7 Pro", aliases: ["Note 7"], popularity: 80 },

  // Redmi Budget Series
  { brand: "Xiaomi", model: "Redmi 13C 5G", aliases: ["Redmi 13C", "13C 5G"], popularity: 99 },
  { brand: "Xiaomi", model: "Redmi 13C 4G", aliases: ["Redmi 13C"], popularity: 98 },
  { brand: "Xiaomi", model: "Redmi 12 5G", aliases: ["Redmi 12", "12 5G"], popularity: 100 },
  { brand: "Xiaomi", model: "Redmi 12 4G", aliases: ["Redmi 12"], popularity: 96 },
  { brand: "Xiaomi", model: "Redmi 11 Prime 5G", aliases: ["11 Prime"], popularity: 88 },
  { brand: "Xiaomi", model: "Redmi 10 Prime", aliases: ["Redmi 10", "Redmi 10A", "Redmi 10C"], popularity: 90 },
  { brand: "Xiaomi", model: "Redmi 9A", aliases: ["Redmi 9", "9 Power", "9 Activ"], popularity: 90 },
  { brand: "Xiaomi", model: "Redmi A3", aliases: ["Redmi A3x", "A3 4G"], popularity: 95 },
  { brand: "Xiaomi", model: "Redmi A2", aliases: ["Redmi A2+", "A2 Plus"], popularity: 92 },
  { brand: "Xiaomi", model: "Redmi A1+", aliases: ["Redmi A1"], popularity: 88 },

  // Xiaomi Flagships
  { brand: "Xiaomi", model: "Xiaomi 14", aliases: ["Mi 14", "Xiaomi 14 Ultra", "Xiaomi 14 Civi"], popularity: 88 },
  { brand: "Xiaomi", model: "Xiaomi 13 Pro", aliases: ["Mi 13 Pro"], popularity: 82 },
  { brand: "Xiaomi", model: "Xiaomi Pad 6", aliases: ["Mi Pad 6"], popularity: 85 },

  // ==================== SAMSUNG ====================
  // Galaxy S Series
  { brand: "Samsung", model: "Samsung Galaxy S24 Ultra", aliases: ["S24 Ultra", "Galaxy S24 Ultra"], popularity: 96 },
  { brand: "Samsung", model: "Samsung Galaxy S24", aliases: ["S24", "Galaxy S24", "S24+"], popularity: 95 },
  { brand: "Samsung", model: "Samsung Galaxy S23 Ultra", aliases: ["S23 Ultra"], popularity: 94 },
  { brand: "Samsung", model: "Samsung Galaxy S23 FE", aliases: ["S23 FE", "Galaxy S23 FE"], popularity: 95 },
  { brand: "Samsung", model: "Samsung Galaxy S23", aliases: ["S23", "S23+"], popularity: 92 },
  { brand: "Samsung", model: "Samsung Galaxy S21 FE 5G", aliases: ["S21 FE"], popularity: 92 },
  { brand: "Samsung", model: "Samsung Galaxy S20 FE 5G", aliases: ["S20 FE"], popularity: 88 },

  // Galaxy A Series
  { brand: "Samsung", model: "Samsung Galaxy A55 5G", aliases: ["A55", "Galaxy A55"], popularity: 96 },
  { brand: "Samsung", model: "Samsung Galaxy A35 5G", aliases: ["A35", "Galaxy A35"], popularity: 97 },
  { brand: "Samsung", model: "Samsung Galaxy A25 5G", aliases: ["A25", "Galaxy A25"], popularity: 93 },
  { brand: "Samsung", model: "Samsung Galaxy A15 5G", aliases: ["A15", "Galaxy A15 5G"], popularity: 100 },
  { brand: "Samsung", model: "Samsung Galaxy A05s", aliases: ["A05s", "Galaxy A05s"], popularity: 96 },
  { brand: "Samsung", model: "Samsung Galaxy A05", aliases: ["A05"], popularity: 94 },
  { brand: "Samsung", model: "Samsung Galaxy A54 5G", aliases: ["A54", "Galaxy A54"], popularity: 95 },
  { brand: "Samsung", model: "Samsung Galaxy A34 5G", aliases: ["A34", "Galaxy A34"], popularity: 94 },
  { brand: "Samsung", model: "Samsung Galaxy A14 5G", aliases: ["A14", "Galaxy A14"], popularity: 98 },
  { brand: "Samsung", model: "Samsung Galaxy A23 5G", aliases: ["A23", "Galaxy A23"], popularity: 90 },
  { brand: "Samsung", model: "Samsung Galaxy A53 5G", aliases: ["A53"], popularity: 88 },
  { brand: "Samsung", model: "Samsung Galaxy A73 5G", aliases: ["A73"], popularity: 85 },
  { brand: "Samsung", model: "Samsung Galaxy A52s 5G", aliases: ["A52s", "A52"], popularity: 88 },
  { brand: "Samsung", model: "Samsung Galaxy A51", aliases: ["Galaxy A51"], popularity: 86 },
  { brand: "Samsung", model: "Samsung Galaxy A31", aliases: ["Galaxy A31"], popularity: 82 },
  { brand: "Samsung", model: "Samsung Galaxy A12", aliases: ["Galaxy A12"], popularity: 88 },
  { brand: "Samsung", model: "Samsung Galaxy A50", aliases: ["Galaxy A50s", "A50"], popularity: 85 },

  // Galaxy M & F Series
  { brand: "Samsung", model: "Samsung Galaxy M55 5G", aliases: ["M55", "Galaxy M55"], popularity: 92 },
  { brand: "Samsung", model: "Samsung Galaxy M35 5G", aliases: ["M35", "Galaxy M35"], popularity: 95 },
  { brand: "Samsung", model: "Samsung Galaxy M15 5G", aliases: ["M15", "Galaxy M15"], popularity: 97 },
  { brand: "Samsung", model: "Samsung Galaxy M34 5G", aliases: ["M34"], popularity: 94 },
  { brand: "Samsung", model: "Samsung Galaxy M14 5G", aliases: ["M14", "Galaxy M14"], popularity: 98 },
  { brand: "Samsung", model: "Samsung Galaxy M53 5G", aliases: ["M53"], popularity: 85 },
  { brand: "Samsung", model: "Samsung Galaxy M33 5G", aliases: ["M33"], popularity: 90 },
  { brand: "Samsung", model: "Samsung Galaxy M13 5G", aliases: ["M13", "M13 4G"], popularity: 92 },
  { brand: "Samsung", model: "Samsung Galaxy M31", aliases: ["M31s", "M31"], popularity: 88 },
  { brand: "Samsung", model: "Samsung Galaxy M21", aliases: ["M21 2021"], popularity: 85 },
  { brand: "Samsung", model: "Samsung Galaxy F55 5G", aliases: ["F55"], popularity: 90 },
  { brand: "Samsung", model: "Samsung Galaxy F54 5G", aliases: ["F54"], popularity: 88 },
  { brand: "Samsung", model: "Samsung Galaxy F34 5G", aliases: ["F34"], popularity: 91 },
  { brand: "Samsung", model: "Samsung Galaxy F15 5G", aliases: ["F15", "Galaxy F15"], popularity: 96 },
  { brand: "Samsung", model: "Samsung Galaxy F14 5G", aliases: ["F14"], popularity: 94 },
  { brand: "Samsung", model: "Samsung Galaxy F23 5G", aliases: ["F23"], popularity: 88 },

  // Galaxy Z Series
  { brand: "Samsung", model: "Samsung Galaxy Z Flip 6", aliases: ["Z Flip 6", "Flip 6"], popularity: 85 },
  { brand: "Samsung", model: "Samsung Galaxy Z Fold 6", aliases: ["Z Fold 6", "Fold 6"], popularity: 84 },
  { brand: "Samsung", model: "Samsung Galaxy Z Flip 5", aliases: ["Z Flip 5"], popularity: 82 },
  { brand: "Samsung", model: "Samsung Galaxy Z Fold 5", aliases: ["Z Fold 5"], popularity: 80 },

  // ==================== REALME ====================
  // Number Series
  { brand: "Realme", model: "Realme 13 Pro+ 5G", aliases: ["13 Pro Plus", "13 Pro+"], popularity: 95 },
  { brand: "Realme", model: "Realme 13 Pro 5G", aliases: ["13 Pro"], popularity: 94 },
  { brand: "Realme", model: "Realme 12 Pro+ 5G", aliases: ["12 Pro Plus", "12 Pro+"], popularity: 98 },
  { brand: "Realme", model: "Realme 12 Pro 5G", aliases: ["12 Pro", "Realme 12 Pro"], popularity: 98 },
  { brand: "Realme", model: "Realme 12+ 5G", aliases: ["12 Plus", "Realme 12+"], popularity: 96 },
  { brand: "Realme", model: "Realme 12 5G", aliases: ["Realme 12", "12 5G"], popularity: 97 },
  { brand: "Realme", model: "Realme 12x 5G", aliases: ["12x", "Realme 12x"], popularity: 96 },
  { brand: "Realme", model: "Realme 11 Pro+ 5G", aliases: ["11 Pro Plus", "11 Pro+"], popularity: 95 },
  { brand: "Realme", model: "Realme 11 Pro 5G", aliases: ["11 Pro"], popularity: 94 },
  { brand: "Realme", model: "Realme 11 5G", aliases: ["Realme 11", "11 5G"], popularity: 92 },
  { brand: "Realme", model: "Realme 11x 5G", aliases: ["11x", "Realme 11x"], popularity: 93 },
  { brand: "Realme", model: "Realme 10 Pro+ 5G", aliases: ["10 Pro+"], popularity: 90 },
  { brand: "Realme", model: "Realme 9 Pro+", aliases: ["9 Pro Plus", "9 Pro"], popularity: 88 },
  { brand: "Realme", model: "Realme 8 Pro", aliases: ["Realme 8", "8 5G"], popularity: 86 },
  { brand: "Realme", model: "Realme 7", aliases: ["7 Pro"], popularity: 82 },

  // C Series (Budget Volume)
  { brand: "Realme", model: "Realme C67 5G", aliases: ["C67", "C67 5G"], popularity: 96 },
  { brand: "Realme", model: "Realme C65 5G", aliases: ["C65"], popularity: 95 },
  { brand: "Realme", model: "Realme C63", aliases: ["C63"], popularity: 92 },
  { brand: "Realme", model: "Realme C55", aliases: ["C55", "Realme C55"], popularity: 98 },
  { brand: "Realme", model: "Realme C53", aliases: ["C53", "Realme C53"], popularity: 99 },
  { brand: "Realme", model: "Realme C51", aliases: ["C51"], popularity: 94 },
  { brand: "Realme", model: "Realme C35", aliases: ["C35"], popularity: 90 },
  { brand: "Realme", model: "Realme C33", aliases: ["C33"], popularity: 88 },
  { brand: "Realme", model: "Realme C30", aliases: ["C30", "C30s"], popularity: 88 },
  { brand: "Realme", model: "Realme C21Y", aliases: ["C21", "C25s", "C25"], popularity: 84 },
  { brand: "Realme", model: "Realme C11", aliases: ["C11 2021"], popularity: 85 },

  // Narzo Series
  { brand: "Realme", model: "Realme Narzo 70 Pro 5G", aliases: ["Narzo 70 Pro", "70 Pro"], popularity: 95 },
  { brand: "Realme", model: "Realme Narzo 70x 5G", aliases: ["Narzo 70x", "70x"], popularity: 96 },
  { brand: "Realme", model: "Realme Narzo 70 Turbo", aliases: ["Narzo 70 Turbo"], popularity: 92 },
  { brand: "Realme", model: "Realme Narzo 60 Pro 5G", aliases: ["Narzo 60 Pro"], popularity: 94 },
  { brand: "Realme", model: "Realme Narzo 60 5G", aliases: ["Narzo 60", "Narzo 60x 5G"], popularity: 96 },
  { brand: "Realme", model: "Realme Narzo 60x 5G", aliases: ["Narzo 60x"], popularity: 97 },
  { brand: "Realme", model: "Realme Narzo N65 5G", aliases: ["Narzo N65", "N65"], popularity: 93 },
  { brand: "Realme", model: "Realme Narzo N55", aliases: ["Narzo N55", "N55"], popularity: 95 },
  { brand: "Realme", model: "Realme Narzo N53", aliases: ["Narzo N53", "N53"], popularity: 96 },
  { brand: "Realme", model: "Realme Narzo 50 Pro 5G", aliases: ["Narzo 50", "Narzo 50A"], popularity: 88 },

  // GT Series
  { brand: "Realme", model: "Realme GT 6", aliases: ["GT 6", "Realme GT 6T"], popularity: 92 },
  { brand: "Realme", model: "Realme GT 6T", aliases: ["GT 6T"], popularity: 93 },
  { brand: "Realme", model: "Realme GT Neo 3", aliases: ["GT Neo 3T"], popularity: 85 },

  // ==================== OPPO ====================
  // Reno Series
  { brand: "Oppo", model: "Oppo Reno 12 Pro 5G", aliases: ["Reno 12 Pro", "Reno 12"], popularity: 96 },
  { brand: "Oppo", model: "Oppo Reno 12 5G", aliases: ["Reno 12"], popularity: 95 },
  { brand: "Oppo", model: "Oppo Reno 11 Pro 5G", aliases: ["Reno 11 Pro"], popularity: 96 },
  { brand: "Oppo", model: "Oppo Reno 11 5G", aliases: ["Reno 11", "Oppo Reno 11"], popularity: 98 },
  { brand: "Oppo", model: "Oppo Reno 11F 5G", aliases: ["Reno 11F"], popularity: 90 },
  { brand: "Oppo", model: "Oppo Reno 10 Pro+ 5G", aliases: ["Reno 10 Pro Plus", "Reno 10 Pro+"], popularity: 94 },
  { brand: "Oppo", model: "Oppo Reno 10 Pro 5G", aliases: ["Reno 10 Pro"], popularity: 95 },
  { brand: "Oppo", model: "Oppo Reno 10 5G", aliases: ["Reno 10"], popularity: 95 },
  { brand: "Oppo", model: "Oppo Reno 8T 5G", aliases: ["Reno 8T"], popularity: 90 },
  { brand: "Oppo", model: "Oppo Reno 8 Pro", aliases: ["Reno 8", "Reno 8 5G"], popularity: 88 },
  { brand: "Oppo", model: "Oppo Reno 7 Pro", aliases: ["Reno 7", "Reno 6 Pro"], popularity: 85 },

  // F Series
  { brand: "Oppo", model: "Oppo F27 Pro+ 5G", aliases: ["F27 Pro Plus", "F27 Pro+"], popularity: 97 },
  { brand: "Oppo", model: "Oppo F27 5G", aliases: ["F27"], popularity: 94 },
  { brand: "Oppo", model: "Oppo F25 Pro 5G", aliases: ["F25 Pro", "Oppo F25 Pro"], popularity: 99 },
  { brand: "Oppo", model: "Oppo F23 5G", aliases: ["F23", "F23 5G"], popularity: 94 },
  { brand: "Oppo", model: "Oppo F21s Pro 5G", aliases: ["F21s Pro", "F21 Pro 5G"], popularity: 92 },
  { brand: "Oppo", model: "Oppo F21 Pro", aliases: ["F21 Pro"], popularity: 91 },
  { brand: "Oppo", model: "Oppo F19 Pro+ 5G", aliases: ["F19 Pro Plus", "F19 Pro+"], popularity: 90 },
  { brand: "Oppo", model: "Oppo F19", aliases: ["F19s"], popularity: 88 },
  { brand: "Oppo", model: "Oppo F17 Pro", aliases: ["F17"], popularity: 86 },
  { brand: "Oppo", model: "Oppo F15", aliases: ["F15"], popularity: 84 },
  { brand: "Oppo", model: "Oppo F11 Pro", aliases: ["F11"], popularity: 80 },

  // A & K Series
  { brand: "Oppo", model: "Oppo A79 5G", aliases: ["A79", "A79 5G"], popularity: 96 },
  { brand: "Oppo", model: "Oppo A78 5G", aliases: ["A78 5G", "Oppo A78"], popularity: 97 },
  { brand: "Oppo", model: "Oppo A78 4G", aliases: ["A78 4G"], popularity: 94 },
  { brand: "Oppo", model: "Oppo A59 5G", aliases: ["A59", "A59 5G"], popularity: 98 },
  { brand: "Oppo", model: "Oppo A38", aliases: ["A38"], popularity: 95 },
  { brand: "Oppo", model: "Oppo A18", aliases: ["A18"], popularity: 94 },
  { brand: "Oppo", model: "Oppo A58", aliases: ["A58 4G"], popularity: 92 },
  { brand: "Oppo", model: "Oppo A17", aliases: ["A17k", "A17"], popularity: 92 },
  { brand: "Oppo", model: "Oppo A77s", aliases: ["A77", "A77 5G"], popularity: 88 },
  { brand: "Oppo", model: "Oppo A57", aliases: ["A57 2022"], popularity: 90 },
  { brand: "Oppo", model: "Oppo A55", aliases: ["A55 4G"], popularity: 86 },
  { brand: "Oppo", model: "Oppo A54", aliases: ["A54"], popularity: 88 },
  { brand: "Oppo", model: "Oppo A53", aliases: ["A53s 5G"], popularity: 88 },
  { brand: "Oppo", model: "Oppo A31", aliases: ["A31 2020"], popularity: 86 },
  { brand: "Oppo", model: "Oppo A15s", aliases: ["A15"], popularity: 86 },
  { brand: "Oppo", model: "Oppo K12x 5G", aliases: ["K12x"], popularity: 93 },
  { brand: "Oppo", model: "Oppo K10 5G", aliases: ["K10"], popularity: 88 },

  // ==================== ONEPLUS ====================
  // Flagships
  { brand: "OnePlus", model: "OnePlus 12", aliases: ["OP 12", "OnePlus 12 5G"], popularity: 95 },
  { brand: "OnePlus", model: "OnePlus 12R", aliases: ["OP 12R", "OnePlus 12R 5G"], popularity: 99 },
  { brand: "OnePlus", model: "OnePlus 11", aliases: ["OP 11", "OnePlus 11 5G"], popularity: 90 },
  { brand: "OnePlus", model: "OnePlus 11R", aliases: ["OP 11R", "OnePlus 11R 5G"], popularity: 96 },
  { brand: "OnePlus", model: "OnePlus 10 Pro", aliases: ["OP 10 Pro"], popularity: 85 },
  { brand: "OnePlus", model: "OnePlus 10T", aliases: ["OP 10T"], popularity: 86 },
  { brand: "OnePlus", model: "OnePlus 10R", aliases: ["OP 10R"], popularity: 88 },
  { brand: "OnePlus", model: "OnePlus 9 Pro", aliases: ["OP 9 Pro", "OnePlus 9"], popularity: 84 },
  { brand: "OnePlus", model: "OnePlus 9R", aliases: ["OP 9R", "OnePlus 9RT"], popularity: 86 },
  { brand: "OnePlus", model: "OnePlus 8T", aliases: ["OP 8T", "OnePlus 8 Pro"], popularity: 82 },
  { brand: "OnePlus", model: "OnePlus 7T", aliases: ["OP 7T", "7T Pro", "OnePlus 7"], popularity: 80 },

  // Nord Series
  { brand: "OnePlus", model: "OnePlus Nord 4 5G", aliases: ["Nord 4", "OnePlus Nord 4"], popularity: 97 },
  { brand: "OnePlus", model: "OnePlus Nord CE 4 5G", aliases: ["Nord CE 4", "Nord CE4"], popularity: 99 },
  { brand: "OnePlus", model: "OnePlus Nord CE 4 Lite 5G", aliases: ["Nord CE 4 Lite", "Nord CE4 Lite"], popularity: 98 },
  { brand: "OnePlus", model: "OnePlus Nord 3 5G", aliases: ["Nord 3"], popularity: 92 },
  { brand: "OnePlus", model: "OnePlus Nord CE 3 5G", aliases: ["Nord CE 3", "Nord CE3"], popularity: 94 },
  { brand: "OnePlus", model: "OnePlus Nord CE 3 Lite 5G", aliases: ["Nord CE 3 Lite", "Nord CE3 Lite"], popularity: 100 },
  { brand: "OnePlus", model: "OnePlus Nord 2T 5G", aliases: ["Nord 2T", "Nord 2"], popularity: 90 },
  { brand: "OnePlus", model: "OnePlus Nord CE 2 5G", aliases: ["Nord CE 2"], popularity: 90 },
  { brand: "OnePlus", model: "OnePlus Nord CE 2 Lite 5G", aliases: ["Nord CE 2 Lite", "Nord CE2 Lite"], popularity: 96 },
  { brand: "OnePlus", model: "OnePlus Nord", aliases: ["Original Nord"], popularity: 82 },
  { brand: "OnePlus", model: "OnePlus Open", aliases: ["OP Open"], popularity: 80 },

  // ==================== APPLE IPHONE ====================
  { brand: "Apple", model: "iPhone 16 Pro Max", aliases: ["16 Pro Max", "i16 Pro Max"], popularity: 95 },
  { brand: "Apple", model: "iPhone 16 Pro", aliases: ["16 Pro", "i16 Pro"], popularity: 94 },
  { brand: "Apple", model: "iPhone 16 Plus", aliases: ["16 Plus", "i16 Plus"], popularity: 92 },
  { brand: "Apple", model: "iPhone 16", aliases: ["16", "i16"], popularity: 96 },
  { brand: "Apple", model: "iPhone 15 Pro Max", aliases: ["15 Pro Max", "i15 Pro Max"], popularity: 98 },
  { brand: "Apple", model: "iPhone 15 Pro", aliases: ["15 Pro", "i15 Pro"], popularity: 97 },
  { brand: "Apple", model: "iPhone 15 Plus", aliases: ["15 Plus", "i15 Plus"], popularity: 94 },
  { brand: "Apple", model: "iPhone 15", aliases: ["15", "i15", "iPhone 15 128GB"], popularity: 100 },
  { brand: "Apple", model: "iPhone 14 Pro Max", aliases: ["14 Pro Max", "i14 Pro Max"], popularity: 94 },
  { brand: "Apple", model: "iPhone 14 Pro", aliases: ["14 Pro", "i14 Pro"], popularity: 93 },
  { brand: "Apple", model: "iPhone 14 Plus", aliases: ["14 Plus", "i14 Plus"], popularity: 90 },
  { brand: "Apple", model: "iPhone 14", aliases: ["14", "i14", "iPhone 14 128GB"], popularity: 98 },
  { brand: "Apple", model: "iPhone 13 Pro Max", aliases: ["13 Pro Max"], popularity: 92 },
  { brand: "Apple", model: "iPhone 13 Pro", aliases: ["13 Pro"], popularity: 90 },
  { brand: "Apple", model: "iPhone 13", aliases: ["13", "i13", "iPhone 13 128GB"], popularity: 100 },
  { brand: "Apple", model: "iPhone 13 mini", aliases: ["13 mini"], popularity: 80 },
  { brand: "Apple", model: "iPhone 12 Pro Max", aliases: ["12 Pro Max"], popularity: 88 },
  { brand: "Apple", model: "iPhone 12 Pro", aliases: ["12 Pro"], popularity: 86 },
  { brand: "Apple", model: "iPhone 12", aliases: ["12", "i12", "iPhone 12 64GB/128GB"], popularity: 94 },
  { brand: "Apple", model: "iPhone 12 mini", aliases: ["12 mini"], popularity: 78 },
  { brand: "Apple", model: "iPhone 11 Pro Max", aliases: ["11 Pro Max"], popularity: 85 },
  { brand: "Apple", model: "iPhone 11 Pro", aliases: ["11 Pro"], popularity: 83 },
  { brand: "Apple", model: "iPhone 11", aliases: ["11", "i11"], popularity: 92 },
  { brand: "Apple", model: "iPhone XR", aliases: ["XR", "iPhone XR"], popularity: 85 },
  { brand: "Apple", model: "iPhone XS Max", aliases: ["XS Max", "iPhone XS"], popularity: 80 },
  { brand: "Apple", model: "iPhone X", aliases: ["iPhone X", "iX"], popularity: 80 },
  { brand: "Apple", model: "iPhone SE (2022)", aliases: ["iPhone SE 3", "iPhone SE 2020"], popularity: 80 },

  // ==================== POCO ====================
  { brand: "Poco", model: "Poco X6 Pro 5G", aliases: ["X6 Pro", "Poco X6 Pro"], popularity: 97 },
  { brand: "Poco", model: "Poco X6 5G", aliases: ["X6 5G", "Poco X6"], popularity: 95 },
  { brand: "Poco", model: "Poco M6 Pro 5G", aliases: ["M6 Pro", "Poco M6 Pro"], popularity: 98 },
  { brand: "Poco", model: "Poco M6 5G", aliases: ["M6 5G", "Poco M6"], popularity: 96 },
  { brand: "Poco", model: "Poco M6 Plus 5G", aliases: ["M6 Plus"], popularity: 94 },
  { brand: "Poco", model: "Poco C65", aliases: ["C65", "Poco C65"], popularity: 96 },
  { brand: "Poco", model: "Poco C61", aliases: ["C61"], popularity: 90 },
  { brand: "Poco", model: "Poco C55", aliases: ["C55", "Poco C55"], popularity: 92 },
  { brand: "Poco", model: "Poco C51", aliases: ["C51"], popularity: 88 },
  { brand: "Poco", model: "Poco F6 5G", aliases: ["F6", "Poco F6"], popularity: 94 },
  { brand: "Poco", model: "Poco F5 5G", aliases: ["F5"], popularity: 91 },
  { brand: "Poco", model: "Poco X5 Pro 5G", aliases: ["X5 Pro"], popularity: 90 },
  { brand: "Poco", model: "Poco X4 Pro 5G", aliases: ["X4 Pro"], popularity: 88 },
  { brand: "Poco", model: "Poco M4 Pro 5G", aliases: ["M4 Pro"], popularity: 88 },
  { brand: "Poco", model: "Poco X3 Pro", aliases: ["X3", "X3 Pro"], popularity: 88 },
  { brand: "Poco", model: "Poco F1", aliases: ["F1", "Pocophone F1"], popularity: 80 },

  // ==================== iQOO ====================
  { brand: "iQOO", model: "iQOO Z9 5G", aliases: ["Z9", "iQOO Z9"], popularity: 97 },
  { brand: "iQOO", model: "iQOO Z9x 5G", aliases: ["Z9x", "iQOO Z9x"], popularity: 96 },
  { brand: "iQOO", model: "iQOO Z9 Lite 5G", aliases: ["Z9 Lite"], popularity: 93 },
  { brand: "iQOO", model: "iQOO Z7 Pro 5G", aliases: ["Z7 Pro", "iQOO Z7 Pro"], popularity: 96 },
  { brand: "iQOO", model: "iQOO Z7 5G", aliases: ["Z7", "iQOO Z7s"], popularity: 93 },
  { brand: "iQOO", model: "iQOO Neo 9 Pro 5G", aliases: ["Neo 9 Pro"], popularity: 95 },
  { brand: "iQOO", model: "iQOO Neo 7 Pro 5G", aliases: ["Neo 7 Pro", "Neo 7"], popularity: 92 },
  { brand: "iQOO", model: "iQOO 12 5G", aliases: ["iQOO 12"], popularity: 90 },
  { brand: "iQOO", model: "iQOO 11 5G", aliases: ["iQOO 11"], popularity: 84 },
  { brand: "iQOO", model: "iQOO 9 Pro", aliases: ["iQOO 9", "9 SE"], popularity: 82 },
  { brand: "iQOO", model: "iQOO Z6 5G", aliases: ["Z6", "Z6 Lite 5G", "Z6 Pro"], popularity: 90 },

  // ==================== MOTOROLA ====================
  // Edge Series
  { brand: "Motorola", model: "Moto Edge 50 Ultra", aliases: ["Edge 50 Ultra"], popularity: 88 },
  { brand: "Motorola", model: "Moto Edge 50 Pro", aliases: ["Edge 50 Pro", "Moto Edge 50 Pro"], popularity: 96 },
  { brand: "Motorola", model: "Moto Edge 50 Fusion", aliases: ["Edge 50 Fusion"], popularity: 95 },
  { brand: "Motorola", model: "Moto Edge 40 Neo", aliases: ["Edge 40 Neo", "Moto Edge 40 Neo"], popularity: 96 },
  { brand: "Motorola", model: "Moto Edge 40", aliases: ["Edge 40"], popularity: 92 },
  { brand: "Motorola", model: "Moto Edge 30 Fusion", aliases: ["Edge 30"], popularity: 85 },

  // G & E Series
  { brand: "Motorola", model: "Moto G85 5G", aliases: ["G85", "Moto G85"], popularity: 97 },
  { brand: "Motorola", model: "Moto G64 5G", aliases: ["G64", "Moto G64"], popularity: 95 },
  { brand: "Motorola", model: "Moto G54 5G", aliases: ["G54", "Moto G54"], popularity: 98 },
  { brand: "Motorola", model: "Moto G34 5G", aliases: ["G34", "Moto G34"], popularity: 98 },
  { brand: "Motorola", model: "Moto G24 Power", aliases: ["G24", "Moto G24"], popularity: 94 },
  { brand: "Motorola", model: "Moto G14", aliases: ["G14", "Moto G14"], popularity: 90 },
  { brand: "Motorola", model: "Moto G84 5G", aliases: ["G84", "Moto G84"], popularity: 96 },
  { brand: "Motorola", model: "Moto G73 5G", aliases: ["G73"], popularity: 88 },
  { brand: "Motorola", model: "Moto G62 5G", aliases: ["G62"], popularity: 86 },
  { brand: "Motorola", model: "Moto G52", aliases: ["G52"], popularity: 86 },
  { brand: "Motorola", model: "Moto G32", aliases: ["G32"], popularity: 85 },
  { brand: "Motorola", model: "Moto E13", aliases: ["E13"], popularity: 88 },
  { brand: "Motorola", model: "Moto E22s", aliases: ["E22s"], popularity: 84 },
  { brand: "Motorola", model: "Moto Razr 50 Ultra", aliases: ["Razr 50", "Razr 40 Ultra"], popularity: 82 },

  // ==================== INFINIX ====================
  { brand: "Infinix", model: "Infinix GT 20 Pro 5G", aliases: ["GT 20 Pro"], popularity: 92 },
  { brand: "Infinix", model: "Infinix Note 40 Pro 5G", aliases: ["Note 40 Pro", "Note 40 Pro+"], popularity: 94 },
  { brand: "Infinix", model: "Infinix Note 30 5G", aliases: ["Note 30 5G"], popularity: 92 },
  { brand: "Infinix", model: "Infinix Hot 40i", aliases: ["Hot 40i"], popularity: 93 },
  { brand: "Infinix", model: "Infinix Hot 30i", aliases: ["Hot 30i"], popularity: 92 },
  { brand: "Infinix", model: "Infinix Hot 20 5G", aliases: ["Hot 20"], popularity: 88 },
  { brand: "Infinix", model: "Infinix Smart 8 HD", aliases: ["Smart 8", "Smart 8 Plus"], popularity: 92 },
  { brand: "Infinix", model: "Infinix Zero 30 5G", aliases: ["Zero 30"], popularity: 88 },

  // ==================== TECNO ====================
  { brand: "Tecno", model: "Tecno Camon 30 5G", aliases: ["Camon 30", "Camon 30 Premier"], popularity: 90 },
  { brand: "Tecno", model: "Tecno Pova 6 Pro 5G", aliases: ["Pova 6 Pro"], popularity: 92 },
  { brand: "Tecno", model: "Tecno Pova 5 Pro 5G", aliases: ["Pova 5 Pro"], popularity: 90 },
  { brand: "Tecno", model: "Tecno Spark 20 5G", aliases: ["Spark 20", "Spark 20C"], popularity: 93 },
  { brand: "Tecno", model: "Tecno Spark Go 2024", aliases: ["Spark Go"], popularity: 92 },
  { brand: "Tecno", model: "Tecno Phantom V Fold", aliases: ["Phantom V Fold"], popularity: 80 },

  // ==================== NOTHING / CMF ====================
  { brand: "Nothing", model: "Nothing Phone (2a)", aliases: ["Phone 2a", "Nothing Phone 2a", "Nothing 2a"], popularity: 96 },
  { brand: "Nothing", model: "Nothing Phone (2)", aliases: ["Phone 2", "Nothing Phone 2"], popularity: 92 },
  { brand: "Nothing", model: "Nothing Phone (1)", aliases: ["Phone 1", "Nothing Phone 1"], popularity: 90 },
  { brand: "Nothing", model: "CMF Phone 1", aliases: ["CMF Phone", "CMF 1"], popularity: 95 },

  // ==================== LAVA ====================
  { brand: "Lava", model: "Lava Agni 2 5G", aliases: ["Agni 2", "Lava Agni 2"], popularity: 92 },
  { brand: "Lava", model: "Lava Agni 3 5G", aliases: ["Agni 3"], popularity: 90 },
  { brand: "Lava", model: "Lava Blaze Curve 5G", aliases: ["Blaze Curve"], popularity: 91 },
  { brand: "Lava", model: "Lava Blaze 2 5G", aliases: ["Blaze 2", "Blaze 5G"], popularity: 92 },
  { brand: "Lava", model: "Lava Yuva 3", aliases: ["Yuva 3 Pro", "Yuva 2 Pro"], popularity: 90 },
  { brand: "Lava", model: "Lava Storm 5G", aliases: ["Storm 5G"], popularity: 88 },
  { brand: "Lava", model: "Lava O2", aliases: ["Lava O2"], popularity: 86 },
];

export interface AutoSuggestResult {
  model: string;
  brand: string;
  isDb?: boolean;
  score: number;
}

/**
 * Searches smartphone models using prefix, keyword, acronym, and fuzzy matching.
 * Also seamlessly incorporates any custom phone models existing in the shop's database.
 * 
 * Examples:
 * - Query "v" or "V" -> Vivo Y20, Vivo V29, Vivo T2 5G, Vivo V27, Vivo Y200, Vivo V30, etc.
 * - Query "rn13" -> Redmi Note 13 5G
 * - Query "s24" -> Samsung Galaxy S24 Ultra, Samsung Galaxy S24
 * - Query "15 pro" -> iPhone 15 Pro, iPhone 15 Pro Max
 */
export function searchPhoneModels(
  query: string,
  customDbModels: string[] = [],
  limit = 12
): AutoSuggestResult[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];

  const results: AutoSuggestResult[] = [];
  const seenModels = new Set<string>();

  // 1. Process custom DB models from user's store inventory first
  customDbModels.forEach((dbModel) => {
    if (!dbModel || !dbModel.trim()) return;
    const cleanDb = dbModel.trim();
    const cleanLower = cleanDb.toLowerCase();
    const key = cleanLower.replace(/\s+/g, "");
    if (seenModels.has(key)) return;

    let score = 0;
    if (cleanLower === q) score = 1000;
    else if (cleanLower.startsWith(q)) score = 800;
    else if (cleanLower.split(/\s+/).some((word) => word.startsWith(q))) score = 650;
    else if (cleanLower.includes(q)) score = 500;

    if (score > 0) {
      // Try to detect brand from the name
      let brand = "Custom";
      const matchedBrand = POPULAR_PHONE_MODELS.find(
        (p) => cleanLower.includes(p.brand.toLowerCase())
      );
      if (matchedBrand) brand = matchedBrand.brand;

      results.push({
        model: cleanDb,
        brand,
        isDb: true,
        score: score + 50, // Slight boost for store's own models
      });
      seenModels.add(key);
    }
  });

  // 2. Process built-in popular models
  POPULAR_PHONE_MODELS.forEach((item) => {
    const key = item.model.toLowerCase().replace(/\s+/g, "");
    if (seenModels.has(key)) return;

    const modelLower = item.model.toLowerCase();
    const brandLower = item.brand.toLowerCase();
    const popBonus = (item.popularity || 80) / 10; // 8-10 points

    let score = 0;

    // Direct exact or prefix match on Full Name (e.g. "Vivo V29")
    if (modelLower === q) {
      score = 900;
    } else if (modelLower.startsWith(q)) {
      score = 750;
    } else if (brandLower === q) {
      // e.g. User typed "vivo" -> score highly so top Vivo models come first
      score = 700;
    } else if (brandLower.startsWith(q)) {
      // e.g. User typed "v" -> matches brand "vivo", prioritize top popularity Vivo models
      score = 680;
    } else {
      // Word prefix matching (e.g. "v29" matches "Vivo V29", "y20" matches "Vivo Y20")
      const words = modelLower.split(/[\s-]+/);
      const wordMatch = words.some((w) => w.startsWith(q));
      if (wordMatch) {
        score = 600;
      } else if (modelLower.includes(q)) {
        score = 400;
      }

      // Check aliases (e.g. "rn13" -> "RN13", "y20" -> "Y20")
      if (item.aliases && item.aliases.length > 0) {
        for (const alias of item.aliases) {
          const aLower = alias.toLowerCase();
          if (aLower === q) {
            score = Math.max(score, 700);
            break;
          } else if (aLower.startsWith(q)) {
            score = Math.max(score, 580);
            break;
          } else if (aLower.includes(q)) {
            score = Math.max(score, 350);
            break;
          }
        }
      }
    }

    if (score > 0) {
      results.push({
        model: item.model,
        brand: item.brand,
        score: score + popBonus,
      });
      seenModels.add(key);
    }
  });

  // Sort by score descending and return top matches
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Detect brand name from model string (e.g. "Vivo Y20" -> "Vivo", "Redmi Note 12" -> "Xiaomi", "iPhone 15" -> "Apple")
 */
export function detectBrandFromModel(modelName: string): string {
  if (!modelName) return "";
  const lower = modelName.toLowerCase();

  if (lower.includes("vivo")) return "Vivo";
  if (lower.includes("iqoo")) return "iQOO";
  if (lower.includes("redmi") || lower.includes("xiaomi") || lower.includes("mi ")) return "Xiaomi";
  if (lower.includes("samsung") || lower.includes("galaxy")) return "Samsung";
  if (lower.includes("realme") || lower.includes("narzo")) return "Realme";
  if (lower.includes("oppo") || lower.includes("reno")) return "Oppo";
  if (lower.includes("oneplus") || lower.includes("nord")) return "OnePlus";
  if (lower.includes("iphone") || lower.includes("apple")) return "Apple";
  if (lower.includes("moto") || lower.includes("motorola")) return "Motorola";
  if (lower.includes("poco")) return "Poco";
  if (lower.includes("infinix")) return "Infinix";
  if (lower.includes("tecno")) return "Tecno";
  if (lower.includes("nothing") || lower.includes("cmf")) return "Nothing";
  if (lower.includes("lava")) return "Lava";

  // Check lookup catalog
  const match = POPULAR_PHONE_MODELS.find((p) =>
    modelName.toLowerCase().includes(p.model.toLowerCase())
  );
  return match ? match.brand : "";
}
