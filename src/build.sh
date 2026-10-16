#!/usr/bin/env bash
# 把 src/ 下的源码拼成单文件 报价单助手.html
# 用法：bash src/build.sh
set -e
cd "$(dirname "$0")"
OUT="../报价单助手.html"
cat 02_data.js 03_xlsx.js 04_app.js > /tmp/_qb_check.js
node --check /tmp/_qb_check.js && echo "JS 语法 OK"
{
  cat 01_head.html
  echo '<script>'
  cat 02_data.js 03_xlsx.js 04_app.js
  echo '</script>'
  echo '</body>'
  echo '</html>'
} > "$OUT"
rm -f /tmp/_qb_check.js
echo "已生成 $OUT ($(wc -c < "$OUT") bytes)"
