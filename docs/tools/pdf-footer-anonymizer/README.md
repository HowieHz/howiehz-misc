# PDF 页脚归档转换器

浏览器本地处理支持版式中的 PDF 页脚，将时间和 32 位标识替换为零。

## 源码结构

- [PdfFooterAnonymizer.vue](./PdfFooterAnonymizer.vue) 提供上传、转换与下载界面。
- [redact-footer.ts](./redact-footer.ts) 改写命中的 PDF 内容流。
