# 鰭片顫振計算器

輸入火箭鰭片的尺寸、材料與預期最大速度，算出顫振速度 V<sub>f</sub>，並判定是否達到「最大速度 × 安全係數」。不合格時會列出可達標的厚度、翼展與材料剪切模量。

可以直接上傳（或 Ctrl+V 貼上）OpenRocket 的鰭片設定視窗截圖，自動讀出尺寸與外形。**全部在你的電腦上離線執行，不會上傳任何資料。**

## 下載

到本頁的 [Releases](../../releases) 下載最新版：

| 檔案 | 說明 |
|---|---|
| `FinFlutterCalculator-x.y.z-portable.exe` | 免安裝，雙擊就能用 |
| `FinFlutterCalculator-x.y.z-setup.exe` | 安裝版，會建立開始功能表捷徑 |

目前只提供 Windows 版。程式沒有數位簽章，第一次執行時 Windows SmartScreen 可能出現「Windows 已保護您的電腦」，按「其他資訊 → 仍要執行」即可。

## 使用方式

1. **手動輸入**：填入根部弦長 c<sub>r</sub>、尖端弦長 c<sub>t</sub>、單片翼展 b、厚度 t（mm）、剪切模量 G（GPa）、預期最大速度、安全係數與高度。
2. **截圖輸入**：在 OpenRocket 開啟鰭片設定視窗，截圖後拖進程式、按選擇檔案，或直接 Ctrl+V 貼上。
   - **Trapezoidal Fin Set**：截 General 分頁，讀取 Root chord、Tip chord、Height、Sweep length、Thickness。
   - **Freeform Fin Set**：截 Shape 分頁，讀取座標表，並依座標畫出鰭片外形。座標表可在程式裡核對與修改。
3. 看結果：判定、速度對照、建議調整、不同材料的比較，以及計算過程。

### 使用上的注意

- **剪切模量 G 不會從截圖讀取。** OpenRocket 的材料只有密度，沒有 G。請用供應商的規格表，或用 G = E / (2(1+ν)) 估算。碳纖維板的 G 差異很大（約 3 到 30 GPa 以上），不確定時建議用偏低的值。
- **公式不計入後掠。** 截圖若有後掠，程式會提示。後掠通常使實際顫振速度更高，但這個公式無法量化。
- 簡化公式在高馬赫數或較厚的鰭片上誤差可能變大。**本程式只是設計階段的參考，不能取代正式的氣動彈性分析或飛行測試。**
- 截圖辨識使用離線文字辨識（Tesseract），不是 AI。程式讀到的數字請務必和截圖核對。畫面有深色主題、縮放過或模糊時，可能讀錯。

## 公式

```
λ  = c_t / c_r
S  = (c_r + c_t) / 2 · b
AR = b² / S
V_f = a · √( 2G (t/c_r)³ (AR + 2) / (1.337 · AR³ (λ + 1) · P) )
```

音速 a 與氣壓 P 由「最大速度發生的高度」依標準大氣計算；高度填 0（海平面）是最保守的設定。

## 自己建置

需要 Node.js 22 以上。

```bash
npm install
npm start        # 直接開啟程式
npm run dist     # 打包成 .exe（需在 Windows 上執行），輸出到 dist/
```

## 發佈新版本（維護者）

推上 GitHub 後，用版本標籤觸發自動打包：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 會在 Windows 上建置，並把 `.exe` 附到 Releases。也可以在 Actions 頁面手動執行 `Build Windows app`，建置結果會出現在該次執行的 Artifacts。

## 授權

MIT。使用的第三方元件：Electron（MIT）、Tesseract.js 與 Tesseract 英文語言資料（Apache-2.0）。
