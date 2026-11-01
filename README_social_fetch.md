## social_fetch：抖音 / 小红书公开内容抓取（基于 Scrapling）

### 安装
```bash
pip install "scrapling[fetchers]"
scrapling install        # 下载浏览器（Linux 上系统依赖可能需要 sudo）
```

### 用法
```bash
python scripts/social_fetch.py "https://www.douyin.com/video/<作品ID>"
python scripts/social_fetch.py "https://www.xiaohongshu.com/explore/<笔记ID>?xsec_token=..."
```
输出 JSON：标题、正文、作者、点赞/评论/收藏/分享数、视频直链。

### 实测限制（2026-11-01，未登录）
- **抖音**：需要浏览器模式（StealthyFetcher），普通请求只拿到空壳页面。部分作品未登录时会被换成别的推荐视频，脚本会检测 ID 不一致并报错。视频直链能拿到，也能下载，但很快过期。
- **小红书**：链接必须带 `xsec_token`（从 App 或网页复制的完整分享链接），只有笔记 ID 会跳到 404。普通请求就能拿到正文、互动数和视频直链（下载时要带 Referer）。
- **评论区两边都拿不到**：未登录时评论列表是空的，要登录才能看。本脚本不使用登录或 Cookie。
- 请低频、只用于个人学习，并遵守平台的用户协议。
