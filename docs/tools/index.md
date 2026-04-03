---
publish: false
---

# 实用工具

<script setup lang="ts">
import { data as tools } from "./tools.data.ts";
import { withBase } from "vitepress";
</script>

这里放一些可以直接在页面里使用的小工具。

## 工具列表

<ul v-if="tools.length">
  <li
    v-for="tool in tools"
    :key="tool.url"
  >
    <a :href="withBase(tool.url)">{{ tool.title }}</a>
  </li>
</ul>
<p v-else>暂时还没有可用工具。</p>
