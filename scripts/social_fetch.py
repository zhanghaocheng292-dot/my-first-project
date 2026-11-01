#!/usr/bin/env python3
"""Fetch public metadata from a Douyin video or Xiaohongshu note URL (no login).

Usage: python scripts/social_fetch.py <url>
Outputs JSON. Requires: pip install "scrapling[fetchers]" && scrapling install
"""
import json
import re
import sys
import urllib.parse

from scrapling.fetchers import Fetcher, StealthyFetcher


def _douyin_id(url):
    m = re.search(r"(?:/video/|/note/|modal_id=)(\d{15,20})", url)
    return m.group(1) if m else None


def fetch_douyin(url):
    # Short links (v.douyin.com) are resolved by the browser redirect.
    page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=90000)
    wanted = _douyin_id(url) or _douyin_id(page.url)
    out = {"platform": "douyin", "input_url": url, "final_url": page.url, "requested_id": wanted}
    m = re.search(r'id="RENDER_DATA"[^>]*>([^<]+)<', page.html_content)
    if not m:
        out["error"] = "RENDER_DATA not found (blocked or page layout changed)"
        return out
    data = urllib.parse.unquote(m.group(1))
    got = re.search(r'"awemeId":"(\d+)"', data)
    out["returned_id"] = got.group(1) if got else None
    if out["returned_id"] is None:
        out["error"] = "Video data did not load (anti-bot/slow page). Try again later."
        return out
    if wanted and out["returned_id"] != wanted:
        out["error"] = ("Douyin served a different (recommended) video to a logged-out visitor; "
                        "the requested video was not available without login.")
        return out

    def grab(pat):
        r = re.search(pat, data)
        return r.group(1) if r else None

    out.update({
        "title": grab(r'"itemTitle":"([^"]*)"'),
        "desc": grab(r'"desc":"([^"]*)"'),
        "author": grab(r'"nickname":"([^"]*)"'),
        "likes": grab(r'"diggCount":(\d+)'),
        "comments_count": grab(r'"commentCount":(\d+)'),
        "shares": grab(r'"shareCount":(\d+)'),
        "collects": grab(r'"collectCount":(\d+)'),
        "video_url": grab(r'"playAddr":\[\{"src":"([^"]+)"'),
        "comments": None,
        "comments_note": "Comments are not in the logged-out page; not obtainable this way.",
    })
    return out


def fetch_xhs(url):
    page = Fetcher.get(url, timeout=30)
    if "/404" in page.url or page.status != 200:
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=60000)
    out = {"platform": "xiaohongshu", "input_url": url, "final_url": page.url}
    if "/404" in page.url:
        out["error"] = "Redirected to 404: the link probably lacks a valid xsec_token (use the full share link)."
        return out
    m = re.search(r"__INITIAL_STATE__=(.+?)</script>", page.html_content, re.S)
    if not m:
        out["error"] = "__INITIAL_STATE__ not found"
        return out
    s = m.group(1).replace("\\u002F", "/")

    def grab(pat):
        r = re.search(pat, s)
        return r.group(1) if r else None

    video = grab(r'"masterUrl":"([^"]+)"')
    out.update({
        "title": page.css("title::text").get(),
        "desc": grab(r'"desc":"([^"]*)"'),
        "author": grab(r'"nickname":"([^"]*)"'),
        "likes": grab(r'"likedCount":"([^"]*)"'),
        "comments_count": grab(r'"commentCount":"([^"]*)"'),
        "collects": grab(r'"collectedCount":"([^"]*)"'),
        "shares": grab(r'"shareCount":"([^"]*)"'),
        "video_url": video.replace("http://", "https://", 1) if video else None,
        "comments": None,
        "comments_note": "Comment list is empty for logged-out visitors (loaded later via a login-gated API).",
    })
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/social_fetch.py <douyin-or-xiaohongshu-url>")
    url = sys.argv[1]
    if "douyin.com" in url:
        res = fetch_douyin(url)
    elif "xiaohongshu.com" in url or "xhslink.com" in url:
        res = fetch_xhs(url)
    else:
        res = {"error": "unsupported url"}
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
