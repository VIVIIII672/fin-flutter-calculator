package fincalc.or;

import fincalc.FlutterMath;
import info.openrocket.core.rocketcomponent.FinSet;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.simulation.SimulationStatus;
import info.openrocket.core.simulation.exception.SimulationException;
import info.openrocket.core.simulation.listeners.AbstractSimulationListener;
import info.openrocket.core.logging.Warning;

import java.util.ArrayList;
import java.util.List;

/**
 * 【未編譯驗證】每步記錄最大速度，並在速度超過各鰭組最低顫振速度的 1/安全係數時，
 * 於該高度的大氣條件下重新判斷，並在 endSimulation 時加入警告。
 */
public class FinFlutterListener extends AbstractSimulationListener {
    private final FinFlutterExtension ext;
    private final List<Fin> fins = new ArrayList<>();
    private double worstMargin = Double.POSITIVE_INFINITY, worstV, worstH;
    private String worstName = "";

    private static class Fin { String name; FlutterMath.Geom g; double G; double cx; }

    public FinFlutterListener(FinFlutterExtension ext) { this.ext = ext; }

    @Override
    public void startSimulation(SimulationStatus status) throws SimulationException {
        fins.clear();
        for (RocketComponent c : status.getConfiguration().getRocket()) {
            if (!(c instanceof FinSet)) continue;
            FinSet f = (FinSet) c;
            if (!(f instanceof TrapezoidFinSet)) continue; // 其他形狀目前不處理
            TrapezoidFinSet t = (TrapezoidFinSet) f;
            Fin x = new Fin();
            x.name = f.getName();
            x.g = new FlutterMath.Geom(t.getRootChord(), t.getTipChord(), t.getHeight(), t.getThickness());
            double G = ext.getShearModulusGPa();
            if (G <= 0) G = FlutterMath.guessG(f.getMaterial() == null ? null : f.getMaterial().getName());
            x.G = Double.isNaN(G) ? Double.NaN : G * 1e9;
            x.cx = FlutterMath.centroidX(t.getRootChord(), t.getTipChord(), t.getSweep());
            fins.add(x);
        }
    }

    @Override
    public void postStep(SimulationStatus status) throws SimulationException {
        double v = status.getRocketVelocity().length();
        double h = status.getRocketPosition().z;
        double[] atm = FlutterMath.atmosphere(h);
        for (Fin f : fins) {
            if (Double.isNaN(f.G)) continue;
            double m = FlutterMath.vfMartin(f.g, f.G, atm[1], atm[3]);
            double u = FlutterMath.vfUser(f.g, f.G, atm[1], atm[3]);
            double b = FlutterMath.vfBennett(f.g, f.G, atm[1], atm[3], f.cx);
            double low = Math.min(m, Math.min(u, Double.isNaN(b) ? Double.MAX_VALUE : b));
            double margin = low / v;
            if (v > 1 && margin < worstMargin) { worstMargin = margin; worstV = v; worstH = h; worstName = f.name; }
        }
    }

    @Override
    public void endSimulation(SimulationStatus status, SimulationException e) {
        for (Fin f : fins) if (Double.isNaN(f.G)) {
            status.getWarnings().add(Warning.fromString("Fin flutter: unknown material for '" + f.name + "'; set G manually."));
        }
        if (worstMargin < ext.getSafetyFactor() && !Double.isInfinite(worstMargin)) {
            status.getWarnings().add(Warning.fromString(String.format(
                "Fin flutter: '%s' margin %.2f (< %.2f) at %.0f m, v=%.0f m/s (lowest of 3 formulas).",
                worstName, worstMargin, ext.getSafetyFactor(), worstH, worstV)));
        }
    }
}
