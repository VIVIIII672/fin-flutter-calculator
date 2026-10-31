package fincalc.or;

import info.openrocket.core.simulation.SimulationConditions;
import info.openrocket.core.simulation.exception.SimulationException;
import info.openrocket.core.simulation.extension.AbstractSimulationExtension;

/** 【未編譯驗證】在模擬中加入顫振監測 listener。 */
public class FinFlutterExtension extends AbstractSimulationExtension {

    @Override
    public String getName() { return "Fin flutter check"; }

    @Override
    public String getDescription() {
        return "Checks fin flutter speed (Martin / user formula / Bennett) against the simulated velocity. "
             + "Material shear modulus G is guessed from the material name unless set below.";
    }

    /** 可在設定中覆寫的 G（GPa）；0 表示依材料名稱猜。 */
    public double getShearModulusGPa() { return config.getDouble("G_GPa", 0.0); }
    public void setShearModulusGPa(double v) { config.put("G_GPa", v); fireChangeEvent(); }

    /** 要求的安全係數（最低公式 Vf 需大於最大速度的幾倍）。 */
    public double getSafetyFactor() { return config.getDouble("safety", 1.25); }
    public void setSafetyFactor(double v) { config.put("safety", v); fireChangeEvent(); }

    @Override
    public void initialize(SimulationConditions conditions) throws SimulationException {
        conditions.getSimulationListenerList().add(new FinFlutterListener(this));
    }
}
