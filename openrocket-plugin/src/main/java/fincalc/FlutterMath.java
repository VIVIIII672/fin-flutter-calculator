package fincalc;

/** 純 Java 計算層（不依賴 OpenRocket）。公式與 app/js/physics.js 相同，SI 單位。 */
public final class FlutterMath {
    private FlutterMath() {}

    /** 標準大氣：回傳 {溫度K, 壓力Pa, 密度, 音速}。對流層到 11 km，之後等溫到 20 km。 */
    public static double[] atmosphere(double h) {
        double T0 = 288.15, P0 = 101325.0, g = 9.80665, R = 287.058, L = 0.0065, T, P;
        if (h < 0) h = 0;
        if (h <= 11000) { T = T0 - L * h; P = P0 * Math.pow(T / T0, g / (R * L)); }
        else {
            double T11 = T0 - L * 11000, P11 = P0 * Math.pow(T11 / T0, g / (R * L));
            if (h > 20000) h = 20000;
            T = T11; P = P11 * Math.exp(-g * (h - 11000) / (R * T11));
        }
        return new double[] { T, P, P / (R * T), Math.sqrt(1.4 * R * T) };
    }

    /** 幾何：r 根弦、c 尖弦、b 翼展、t 厚度（m）。 */
    public static final class Geom {
        public final double r, c, b, t;
        public Geom(double r, double c, double b, double t) { this.r = r; this.c = c; this.b = b; this.t = t; }
        public double area() { return (r + c) / 2 * b; }
        public double aspect() { return b * b / area(); }
        public double taper() { return c / r; }
    }

    /** 使用者公式（2G 形式）。 */
    public static double vfUser(Geom g, double G, double P, double a) {
        double AR = g.aspect(), lam = g.taper(), tc = g.t / g.r;
        return a * Math.sqrt(2 * G * Math.pow(tc, 3) * (AR + 2) / (1.337 * Math.pow(AR, 3) * (lam + 1) * P));
    }

    /** Martin 簡化式 = 使用者公式 / √2。 */
    public static double vfMartin(Geom g, double G, double P, double a) { return vfUser(g, G, P, a) / Math.sqrt(2); }

    /** Bennett（質心修正），cx = 質心距根弦前緣；若 ε≤0 回傳 NaN。 */
    public static double vfBennett(Geom g, double G, double P, double a, double cx) {
        double eps = cx / g.r - 0.25;
        if (!(eps > 0)) return Double.NaN;
        double AR = g.aspect(), lam = g.taper(), tau = g.t / g.r, gamma = 1.4;
        double D = (24 * eps * gamma * P / Math.PI) * Math.pow(AR, 3) / (Math.pow(tau, 3) * (AR + 2)) * (lam + 1) / 2;
        return a * Math.sqrt(G / D);
    }

    /** 梯形鰭質心距根弦前緣（沿弦向，面積加權）。sweep 為尖弦前緣後掠量。 */
    public static double centroidX(double r, double c, double sweep) {
        // 梯形面積形心：x = (2*r*0 + ...) 以標準公式
        return (sweep * (r + 2 * c) / (3 * (r + c))) + (r * r + r * c + c * c) / (3 * (r + c));
    }

    /** 溫度對 G 的折減。kPer100：每 100°C 損失的百分比。 */
    public static double gTempFactor(double tC, double kPer100) {
        return Math.max(0.05, 1 - (kPer100 / 100) * (tC - 20) / 100);
    }

    /** 絕熱壁溫（K）：T(1+0.89*0.2*M²)。 */
    public static double adiabaticWallK(double T, double mach) { return T * (1 + 0.89 * 0.2 * mach * mach); }

    /** 依材料名稱關鍵字抓 G（GPa）；找不到回傳 NaN。 */
    public static double guessG(String name) {
        if (name == null) return Double.NaN;
        String n = name.toLowerCase();
        String[][] t = {
            {"carbon","fiber","cfrp","碳","4.5"}, {"fiberglass","g10","fr4","glass","玻","3.0"},
            {"aluminum","aluminium","alu","鋁","26"}, {"plywood","birch","wood","balsa","木","0.6"},
            {"abs","pla","petg","nylon","plastic","塑","0.8"}};
        for (String[] row : t) for (int i = 0; i < row.length - 1; i++) if (n.contains(row[i])) return Double.parseDouble(row[row.length - 1]);
        return Double.NaN;
    }
}
