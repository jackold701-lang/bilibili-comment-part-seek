# B站评论时间坐标选择分P

一个适用于 Tampermonkey 的 Bilibili 视频页脚本。点击评论中的时间坐标后，在页面右侧选择要跳转的分 P。脚本会先切换分 P，等目标视频可播放后，定位到评论时间**前 1 秒**。

> English: Choose a video part when clicking a timestamp in Bilibili comments. The script waits for the selected part to be playable, then seeks one second before the requested time.

## 功能

- 在多 P 视频的评论区点击时间坐标时显示右侧选择面板。
- 自动读取分 P 标题和时长；时间超出某分 P 时，该选项不可选。
- 优先使用 B 站页面自带的分 P 切换。切换期间暂停视频，待目标视频可播放并确认定位后，恢复原来的播放或暂停状态。
- 原生切换无法完成时，以整页跳转作为备用路径。重新加载后再定位；如果浏览器不允许保存临时定位信息，则使用网址时间参数。
- 单 P 视频保留 B 站原有的时间跳转行为。
- 无诊断面板、无操作日志、无第三方统计服务。

## 安装

1. 在浏览器中安装 Tampermonkey。
2. 打开[脚本安装链接](https://raw.githubusercontent.com/jackold701-lang/bilibili-comment-part-seek/main/bilibili-comment-part-seek.user.js)，按脚本管理器提示安装；也可复制 [`bilibili-comment-part-seek.user.js`](./bilibili-comment-part-seek.user.js) 的内容手动新建脚本。
3. 如果已安装本项目的旧版或调试版，请先禁用旧脚本，避免同时拦截同一次点击。
4. 打开或刷新一个 B 站多 P 视频，点击评论中的时间坐标，选择分 P。

脚本已配置 `@updateURL`、`@downloadURL` 和 `@version`，可由 Tampermonkey 检查此仓库的后续版本。

## 示例

在包含 P1、P2 的视频中，点击评论里的 `16:15`，选择 P2。脚本先切到 P2 并暂停等待；P2 可播放后定位到 `16:14`，再按切换前的播放状态继续。

时间坐标为 `0:00` 时仍定位到 `0:00`，不会出现负时间。

## 兼容与限制

- 匹配 `https://www.bilibili.com/video/*`。其它页面类型尚未覆盖。
- 依赖 B 站当前视频页的评论和分 P 列表结构，以及其分 P 信息接口。网站改版后可能需要调整。
- 右侧面板位于网页内容上方，不是 Chrome 扩展程序的浏览器侧边栏。
- 本仓库的自动测试模拟了切 P、等待视频、定位及整页跳转。公开版仍需在真实浏览器中验证；若有问题，请提交 Issue，附视频链接、时间坐标、目标分 P 和实际表现。

## 本地检查

需要 Node.js 18 或更高版本，无需安装第三方依赖：

```sh
npm test
```

测试包括脚本语法、时间计算、原生分 P 切换后的定位，以及整页跳转的临时定位。

## 隐私

脚本只向 `api.bilibili.com` 请求当前视频的分 P 信息。跨页面跳转时，当前标签页的 `sessionStorage` 会暂存视频 BV 号、分 P、目标秒数和原播放状态；定位完成后删除。脚本没有独立服务器或遥测功能。

## 许可证

[MIT](./LICENSE)。本项目与哔哩哔哩官方无关联。
