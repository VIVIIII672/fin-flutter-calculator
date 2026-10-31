# OpenRocket 顫振檢查外掛（實驗版）

**狀態**：計算層（`FlutterMath`）已編譯並與桌面版數值對照（410.8 / 290.5 m/s）。
對接 OpenRocket 的三個類別（`fincalc/or/`）**尚未編譯過**，是依 24.12 文件撰寫。

## 編譯
不想裝 Java：上傳到 GitHub 後，Actions 的「Build OpenRocket plugin」會自動編譯，完成後在該次執行頁面底部 Artifacts 下載 jar；失敗就把紅字錯誤貼回來。自己編譯則需要 JDK 17+ 與 Maven：

    mvn package

產生 `target/fin-flutter-openrocket-0.1.0.jar`。若 Maven 抓不到 `info.openrocket:core:24.12`，
改用 OpenRocket 安裝目錄的 `OpenRocket.jar` 當依賴（`javac -cp OpenRocket.jar ...`）。
**編譯錯誤請整段貼回來。**

## 安裝
把 jar 放進 OpenRocket 的 Plugins 資料夾後重開：
- Windows：`%APPDATA%\OpenRocket\Plugins`
- macOS：`~/Library/Application Support/OpenRocket/Plugins/`
- Linux：`~/.openrocket/Plugins/`

## 使用
模擬設定 → Simulation extensions → Add extension → Analysis → Fin flutter check。
跑模擬後，若最低公式的顫振速度 / 最大速度 < 安全係數（預設 1.25），會在警告中列出。

## 限制
- 只處理梯形鰭；自由形狀與橢圓鰭會略過。
- OpenRocket 材料沒有剪切模量，G 依材料名稱關鍵字猜（碳／玻纖／鋁／木／塑膠），猜不到會警告，可在設定手動輸入。
- 只用 ISA 標準大氣的高度修正，未用模擬的實際大氣。
- 結果是經驗公式，需以 Ansys 或實驗驗證。
