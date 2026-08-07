# BlogsClub 签到助手

[English](./README.md) | **简体中文** | [繁體中文](./README.zh-Hant.md)

BlogsClub 签到助手是一个用户脚本，用于后台检查 BlogsClub 每日签到状态，在需要时提醒你，并在你完成 Geetest 验证码后提交签到。

脚本不会自动识别、绕过或代替你完成验证码，验证码必须由你手动完成。

## 功能特点

- 后台检查每日签到状态；
- 立即检查并在需要时打开 Geetest 验证码；
- 手动验证后提交签到，并显示今日排名；
- 可选在服务端零点前准备验证码、零点后提交；
- 通过 HTTP `Date` 响应头估算 BlogsClub 服务端时钟；
- 复用有效会话和正在进行中的请求，减少不必要的请求。
- 菜单和通知支持 English、简体中文、繁體中文；首次加载时按浏览器语言偏好选择并保存。

## 支持的脚本引擎

支持 [Tampermonkey](https://www.tampermonkey.net)、[Violentmonkey](https://violentmonkey.github.io)、[Greasemonkey](https://www.greasespot.net)、[ScriptCat](https://docs.scriptcat.org) 等脚本引擎。

## 文档

完整的行为说明、菜单配置、网络请求、隐私提示、故障排查和已知限制，请阅读 [howiehz.top/misc/blogsclub-signin-helper](https://howiehz.top/misc/blogsclub-signin-helper/)。

## 快速开始

1. 安装兼容的用户脚本管理器。
2. 打开 [Greasy Fork 上的 BlogsClub 签到助手](https://greasyfork.org/scripts/590073-blogsclub-check-in-helper) 并安装。
3. 打开 `https://www.blogsclub.org/` 或其他 BlogsClub 页面。
4. 在用户脚本管理器菜单中选择 `BlogsClub 账号：未设置`，输入邮箱和密码。
5. 选择 `立即检查/签到` 立即检查；如果当天还未签到，脚本会打开 Geetest 验证码。

默认只在 BlogsClub 页面检查。密码保存在用户脚本管理器的本地存储中，只发送到 BlogsClub 登录接口。

## 开发

在仓库根目录安装依赖后运行：

```bash
pnpm --filter blogsclub-signin-helper build
```

构建 `dist/` 中的用户脚本产物。

```bash
pnpm --filter blogsclub-signin-helper watch
```

源文件变化时自动重新构建用户脚本。

```bash
pnpm --filter blogsclub-signin-helper dev
```

启动带 HMR 的 Vite 开发服务器。

```bash
pnpm --filter blogsclub-signin-helper preview
```

构建用户脚本后，在本地启动服务器提供生成的 `dist/` 产物。
