---
aside: false
publish: false
published: 2026-09-05T00:00:00+08:00
---

# PDF 页脚字段清理器

在浏览器本地读取并转换，将支持版式中页脚的时间与 32 位标识替换为零。同时将 PDF 元数据字典的修改时间修改为创建时间。

<!-- autocorrect-disable -->
<script setup lang="ts">
import PdfFooterAnonymizer from "./PdfFooterAnonymizer.vue";
</script>

<PdfFooterAnonymizer />
<!-- autocorrect-enable -->

仅支持页脚文字以 PDF 十六进制文本流保存、格式为“时间 + 32 位标识”的文件。未找到匹配项时不会生成输出文件。
