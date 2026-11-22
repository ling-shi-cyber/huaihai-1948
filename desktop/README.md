# Windows 桌面版源码

本目录把网页版游戏封装为 Windows 桌面应用：WinForms 窗口 + Microsoft Edge WebView2 显示游戏，窗口标题与图标为“淮海战役 1948”。

## 目录

```
Program.cs          主程序（窗口、WebView2、全屏、回退到 Edge）
AssemblyInfo.cs     程序集/文件版本信息
app.manifest        DPI 与 Windows 兼容性清单
app.ico             应用图标（多尺寸）
make_icon.py        生成图标（Pillow）
build.ps1           构建脚本：编译、复制资源、打包 zip
lib/                Microsoft.Web.WebView2 SDK（net462 + x64 Loader）
```

## 构建

要求：

- Windows 10/11 64 位
- .NET Framework 4.8 自带的 `csc.exe`（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）
- `lib/` 中的 WebView2 SDK 文件

在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

输出：

```
dist\淮海战役1948\
  淮海战役1948.exe
  Microsoft.Web.WebView2.Core.dll
  Microsoft.Web.WebView2.WinForms.dll
  WebView2Loader.dll
  WebView2-LICENSE.txt
  web\...
  使用说明.txt
dist\淮海战役1948-便携版.zip
```

## 运行机制

1. 启动后显示深色启动画面，异步创建 WebView2 环境。
2. 将程序目录下的 `web` 文件夹映射到虚拟主机 `https://huaihai.local/`，加载 `index.html`。
3. 关闭默认右键菜单、开发者工具、页面缩放与浏览器快捷键；F11 / Esc 由游戏通过 `chrome.webview.postMessage` 桥接控制原生窗口全屏。
4. 若 WebView2 初始化失败（运行时缺失、被策略禁用、组件损坏等），自动尝试用本机 Edge 的 `--app` 应用窗口打开同一份 `web/index.html`；再失败则用默认浏览器打开。
5. 用户数据目录优先 `%LOCALAPPDATA%\Huaihai1948\WebView2`，不可写时回退到 `%TEMP%` 或程序目录。游戏存档（localStorage）就在该目录内，卸载/清理该目录会清空存档。手动存档与自动存档都支持自定义名称；自动存档改名后，同一次战役的后续自动保存会沿用该名称，新战役会恢复为“自动存档”。
6. 关闭窗口时，`FormClosing` 会先执行页面中的 `HX.Save.autoSaveForExit()`，最多等待 2.5 秒，再真正退出；战役菜单的“退出游戏”通过 `quit-game` 消息走同一流程。

## 注意

- 未做数字签名；对外分发时 Windows SmartScreen 可能提示，属正常现象。
- 需要 `.NET Framework 4.8`（Windows 10/11 默认包含）与 WebView2 运行时（Edge 通常自带）。
- 游戏本体在 `../` 的网页版；桌面版只是外壳，修改游戏后重新运行 `build.ps1` 即可。
