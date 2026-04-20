---
publish: false
---

# Tools

<script setup lang="ts">
import { data as tools } from "./tools.node.data.ts";
import { withBase } from "vitepress";
</script>

Small utilities live here.

## Available Tools

<ul v-if="tools.length">
  <li
    v-for="tool in tools"
    :key="tool.url"
  >
    <a :href="withBase(tool.url)">{{ tool.title }}</a>
  </li>
</ul>
<p v-else>No tools are available yet.</p>
