package fincalc;

public class FlutterMathTest {
    static int fails = 0;
    static void near(String n, double got, double want, double tol) {
        boolean ok = Math.abs(got - want) <= tol * Math.abs(want);
        System.out.println((ok ? "ok   " : "FAIL ") + n + " got=" + got + " want=" + want);
        if (!ok) fails++;
    }
    public static void main(String[] a) {
        double[] s = FlutterMath.atmosphere(0);
        near("海平面溫度", s[0], 288.15, 1e-9); near("海平面音速", s[3], 340.294, 1e-3);
        near("海平面密度", s[2], 1.225, 2e-3);
        near("10 km 壓力", FlutterMath.atmosphere(10000)[1], 26436, 2e-3);
        FlutterMath.Geom g = new FlutterMath.Geom(0.15, 0.075, 0.1, 0.003);
        double[] at = FlutterMath.atmosphere(0);
        double u = FlutterMath.vfUser(g, 4.5e9, at[1], at[3]);
        near("martin = user/√2", FlutterMath.vfMartin(g, 4.5e9, at[1], at[3]), u / Math.sqrt(2), 1e-12);
        near("bennett(ε=0.25)=martin", FlutterMath.vfBennett(g, 4.5e9, at[1], at[3], 0.5 * g.r), FlutterMath.vfMartin(g, 4.5e9, at[1], at[3]), 1e-4);
        near("溫度折減", FlutterMath.gTempFactor(120, 10), 0.9, 1e-12);
        near("矩形質心", FlutterMath.centroidX(0.1, 0.1, 0), 0.05, 1e-12);
        System.out.println("USER=" + u + " MARTIN=" + FlutterMath.vfMartin(g, 4.5e9, at[1], at[3]));
        if (fails > 0) { System.out.println(fails + " 失敗"); System.exit(1); }
    }
}
