# 淮海战役 1948 · Windows 桌面版构建脚本
$ErrorActionPreference = 'Stop'

$desktop = $PSScriptRoot
$root = Split-Path -Parent $desktop
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$distRoot = Join-Path $root 'dist'
$dist = Join-Path $distRoot '淮海战役1948'
$web = Join-Path $dist 'web'

if (-not (Test-Path $csc)) { throw "找不到 .NET Framework 编译器：$csc" }
if (-not (Test-Path (Join-Path $desktop 'lib\Microsoft.Web.WebView2.Core.dll'))) {
    throw '缺少 desktop\lib 下的 WebView2 SDK 文件'
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $dist | Out-Null
New-Item -ItemType Directory -Force $web | Out-Null

# 复制网页资源
Copy-Item (Join-Path $root 'index.html') $web
Copy-Item (Join-Path $root 'css') $web -Recurse
Copy-Item (Join-Path $root 'js') $web -Recurse
Copy-Item (Join-Path $root '文章.jpg') $web

# 复制 WebView2 运行库
Copy-Item (Join-Path $desktop 'lib\Microsoft.Web.WebView2.Core.dll') $dist
Copy-Item (Join-Path $desktop 'lib\Microsoft.Web.WebView2.WinForms.dll') $dist
Copy-Item (Join-Path $desktop 'lib\WebView2Loader.dll') $dist
Copy-Item (Join-Path $desktop 'lib\WebView2-LICENSE.txt') $dist
Copy-Item (Join-Path $root 'LICENSE') $dist
Copy-Item (Join-Path $root 'NOTICE') $dist

$exe = Join-Path $dist '淮海战役1948.exe'
Write-Host '正在编译桌面程序…'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 `
    /win32icon:"$desktop\app.ico" `
    /win32manifest:"$desktop\app.manifest" `
    /out:"$exe" `
    /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    /r:"$desktop\lib\Microsoft.Web.WebView2.Core.dll" `
    /r:"$desktop\lib\Microsoft.Web.WebView2.WinForms.dll" `
    "$desktop\Program.cs" "$desktop\AssemblyInfo.cs"
if ($LASTEXITCODE -ne 0) { throw "编译失败，退出码 $LASTEXITCODE" }

$readme = @"
淮海战役 1948 · 战役沙盘（Windows 桌面版）
==========================================

【运行】
解压整个压缩包后，双击“淮海战役1948.exe”。
请保持 exe、三个 DLL 与 web 文件夹在同一目录，不要单独移动 exe。

【系统要求】
Windows 10 / 11 64 位。
程序使用系统内置的 Microsoft Edge WebView2 运行时；绝大多数 Windows 10/11 已自带。
若提示缺少 WebView2，请安装：
https://go.microsoft.com/fwlink/p/?LinkId=2124703
（若 WebView2 不可用，程序会自动改用本机 Edge 的应用窗口运行，功能一致。）

【操作】
鼠标左键：选择部队 / 查看敌军
Shift + 左键：多选
左键拖框：框选我军
右键点击地图：行军
右键点击敌军：攻击预估（确认后下达）
Shift + 右键：跳过预估，直接攻击
右键拖动：平移地图
滚轮：缩放
E：执行本日
空格：自动推演 / 暂停
F：隐藏 / 显示侧栏
F11：窗口全屏 / 退出全屏
Esc：取消选择 / 取消指令；无选择时打开战役菜单
Tab：轮换选中我军部队

【作战辅助】
攻击预估：显示双方战力比、预计伤亡区间，以及地形、工事、渡河、炮兵、合击等修正。
战报会附本次战斗的主要修正，方便理解结果。
首次开局有 4 步新手引导；作战手册里可以重新播放。
顶栏 ♪ 按钮开关音效。

【存档与退出】
每回合结束自动存档；重新打开游戏后，点主菜单“继续战役”即可接着打。
游戏中点右上角 ☰ 打开战役菜单：
- 保存进度：3 个手动存档位；保存时命名，之后可随时重命名
- 读取存档 / 删除存档（均会确认）
- 自动存档也可以重命名，后续自动保存会保留名称
- 返回主菜单 / 退出游戏
返回主菜单、退出游戏、关闭窗口都会自动存档。存档保存在本机，不上传。
存档位置：%LOCALAPPDATA%\Huaihai1948（WebView2 用户数据目录）；清理该目录会清空存档。

【首次运行提示】
如果 Windows 提示“Windows 已保护你的电脑”，这是未签名程序的 SmartScreen 提示：
点击“更多信息” → “仍要运行”即可。程序不联网、不收集任何数据。

【游戏文件】
淮海战役1948.exe        主程序
Microsoft.Web.WebView2.*.dll  WebView2 托管组件
WebView2Loader.dll      WebView2 加载器
web\                    游戏资源（含史料图片、地图、脚本）
LICENSE / NOTICE         MIT 许可证与第三方说明

【史料】
游戏内“命令原文”可查看《华东野战军淮海战役攻击命令（节选）》（1948年11月4日）影印件。
本作为历史战役模拟，兵力与战果为模型推演值。
内置 Microsoft Edge WebView2 SDK 组件，版权归 Microsoft Corporation 所有。
"@
$readmePath = Join-Path $dist '使用说明.txt'
[System.IO.File]::WriteAllText($readmePath, $readme, (New-Object System.Text.UTF8Encoding($true)))

# 打包便携版
$zip = Join-Path $distRoot '淮海战役1948-便携版.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host '正在打包便携版 zip…'
Compress-Archive -Path $dist -DestinationPath $zip -CompressionLevel Optimal

Write-Host ''
Write-Host '构建完成：'
Get-ChildItem $dist | Select-Object Name, Length | Format-Table -AutoSize
Write-Host ("便携版：{0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
Write-Host ("主程序：{0}  ({1:N0} KB)" -f $exe, ((Get-Item $exe).Length / 1KB))
