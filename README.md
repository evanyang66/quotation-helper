# 报价单助手 / Quotation Helper

无需安装、无需 Office 的本地报价工具。双击 `报价单助手.html`，用 Edge / Chrome 打开即可。

- 管理物料库、套用模板并填写报价明细。
- 编辑数量、单价、分组、小计和选配项目。
- 粘贴产品图片，导出 Excel、打印或保存 PDF。
- 在浏览器本地保存数据，并通过 JSON 备份与恢复。

## 使用与备份

先读 [使用前必读](使用前必读.txt)，完整操作见 [使用说明](使用说明.md)，换电脑前请查看 [迁移说明](换电脑使用说明.md)。浏览器数据不会自动同步；清理浏览器或换电脑前，先导出备份。

## 源码与构建

`src/01_head.html`、`src/02_data.js`、`src/03_xlsx.js`、`src/04_app.js` 组成单文件入口。需要重新构建时安装 Node.js，再用 Git Bash / WSL 执行：

```bash
bash src/build.sh
```

`downloads/quotation-helper.zip` 包含可直接打开的 HTML、源码和使用说明，不包含个人单据或浏览器数据。

个人主页：[EvanYang AI](https://evanyang.kdns.fr/tools)
