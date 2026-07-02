# Lumina Feed · 代码签名与公证

未配置签名时，CI 仍可正常产出 **未签名** 安装包（`.exe` / `.dmg` / `.AppImage`）。用户安装时可能看到系统安全提示，这是预期行为。

配置 GitHub Secrets 后，`release.yml` 会在对应平台自动签名（macOS 还可公证）。

## 能不能获取签名？

| 平台 | 能否获取 | 典型成本 | 说明 |
|------|----------|----------|------|
| **Windows** | 能 | 约 $200–400/年（EV 更贵） | 向 DigiCert、Sectigo 等 CA 购买 **Code Signing Certificate**；也可用 [Azure Trusted Signing](https://azure.microsoft.com/products/trusted-signing)（按量计费） |
| **macOS** | 能 | **$99/年**（Apple Developer） | 需加入 [Apple Developer Program](https://developer.apple.com/programs/)，申请 **Developer ID Application** 证书，并完成 **公证（Notarization）** |
| **Linux** | 一般不需要 | — | AppImage 通常不做代码签名；`.deb` 可选 GPG 签名（本项目默认只发 AppImage） |

个人开发者、小团队完全可以走正规渠道购买；没有证书也能发版，只是会有 SmartScreen / Gatekeeper 警告。

---

## GitHub Secrets 清单

在仓库 **Settings → Secrets and variables → Actions** 中添加：

### Windows（可选）

| Secret | 内容 |
|--------|------|
| `WIN_CSC_LINK` | `.pfx` 证书文件的 **Base64** 字符串 |
| `WIN_CSC_KEY_PASSWORD` | 导出 `.pfx` 时设置的密码 |

生成 Base64（PowerShell）：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\cert.pfx")) | Set-Clipboard
```

### macOS（可选）

| Secret | 内容 |
|--------|------|
| `MAC_CSC_LINK` | Developer ID Application `.p12` 的 **Base64** |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码 |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | [App 专用密码](https://appleid.apple.com)（用于公证） |
| `APPLE_TEAM_ID` | [开发者团队 ID](https://developer.apple.com/account#MembershipDetailsCard)（10 位字符） |

### 在 Mac 上导出 Developer ID 证书

1. 登录 [Apple Developer](https://developer.apple.com/account/resources/certificates/list)
2. 创建 **Developer ID Application** 证书
3. 在「钥匙串访问」中导出为 `.p12`
4. 转为 Base64 填入 `MAC_CSC_LINK`

配置 macOS 签名后，建议在 `package.json` 的 `build.mac` 中启用：

```json
"hardenedRuntime": true,
"gatekeeperAssess": false
```

`electron-builder` 在检测到 `APPLE_ID` + 证书时会自动尝试公证。

---

## 发版流程（推荐）

> 本仓库（`hisonWarren/Lumina-feed`）代码在根目录，`package.json` 即根目录文件。

```bash
# 1. 在 package.json 中 bump version
# 2. 提交并打 tag（版本须与 package.json 一致）
git add package.json
git commit -m "chore: release v0.4.85"
git tag v0.4.85
git push origin main
git push origin v0.4.85
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会：

1. 在 Windows / macOS / Linux 三端并行 `npm run dist`
2. 合并产物并创建 [GitHub Release](https://github.com/hisonWarren/Lumina-feed/releases)
3. 若已配置 Secrets，则在对应平台自动签名

也可在 GitHub **Actions → Release → Run workflow** 手动触发（需已 bump `package.json` 版本）。

---

## 本地发版（单平台）

```bash
npm run dist          # 仅打当前系统安装包
npm run release:gh    # 上传 release/ 内已有资产到 GitHub（需 gh auth login）
```

本地一般只会上传本机平台产物；全平台请用 tag 触发 CI。

---

## 关于 monorepo 与本仓库

本项目源码在 monorepo（`hisonWarren/lumina`）的 `lumina-feed/` 子目录中维护，通过 `git subtree` 同步到本仓库（`hisonWarren/Lumina-feed`）的根目录。因此本仓库内所有路径均以根为基准，CI/CD 与 Release 均在本仓库运行。
