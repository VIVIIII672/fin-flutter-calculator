package fincalc.or;

import info.openrocket.core.plugin.Plugin;
import info.openrocket.core.simulation.extension.AbstractSimulationExtensionProvider;

/**
 * 【未編譯驗證】OpenRocket 24.12 對接層，依文件與記憶撰寫。
 * 若編譯失敗，把錯誤訊息貼回來，我會修正 import 或方法名稱。
 */
@Plugin
public class FinFlutterProvider extends AbstractSimulationExtensionProvider {
    public FinFlutterProvider() {
        super(FinFlutterExtension.class, "Analysis", "Fin flutter check");
    }
}
