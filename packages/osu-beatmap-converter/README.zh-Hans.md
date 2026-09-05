# osu-beatmap-converter

[English](./README.md) | **简体中文**

供 docs 页面使用的零运行时依赖 osu!standard 至 osu!mania 1K、2K、4K 转换内核。

此私有工作区包不会发布到 npm，只处理调用方传入的字符串。

## 库 API

```ts
import { convertOsuBeatmapDetailed } from "osu-beatmap-converter";

const result = convertOsuBeatmapDetailed(inputText, {
  keys: 4,
  removeSv: "all",
  mania2k: {
    mainKey: 1,
    trillStartKey: 1,
    minimumJackTimeInterval: 200,
    maximumNumberOfJackNotes: 1,
  },
});

console.log(result.content);
```

`convertOsuBeatmap(input, options)` 仅返回输出文本；`convertOsuBeatmapDetailed(input, options)` 还返回来源模式、目标键数和序列化物件数。两个函数均只处理传入的字符串。

| 参数                               | 可选值                                   | 作用                                                                                                                      |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `keys`                             | `1`、`2`、`4`                            | 必填，目标 Mania 键数。                                                                                                   |
| `removeSv`                         | `none`、`all`、`inherited_timing_points` | `none` 保留全部变速；`all` 保留 `[TimingPoints]` 段首行后移除其余行；`inherited_timing_points` 仅移除继承时间点（绿线）。 |
| `mania2k.mainKey`                  | `1`、`2`                                 | 1K 转多键时普通音符写入第几条输出轨道；编号从 `1` 开始。                                                                  |
| `mania2k.trillStartKey`            | `1`、`2`                                 | 纵连被拆分为交互段时第一颗音符写入第几条输出轨道；编号从 `1` 开始。                                                       |
| `mania2k.minimumJackTimeInterval`  | 非负毫秒数                               | 小于此间隔的相邻音符属于同一纵连段。                                                                                      |
| `mania2k.maximumNumberOfJackNotes` | 非负整数                                 | 超过此数量的纵连会转为在轨道 1 和轨道 2 之间交替的交互段。                                                                |

轨道从左到右编号为 `1`、`2`、`3`……。普通音符写入 `mainKey`；纵连拆分为交互段后，第一颗音符写入 `trillStartKey`，之后在轨道 `1`、`2` 间交替写入。4K 输出保留四条轨道，但当前只会向轨道 `1`、`2` 写入音符。

库 API 的默认 `removeSv` 为 `"none"`（保留全部变速）；未填写的 `mania2k` 字段使用文档中的默认值。公开 API 会在 JavaScript 边界验证输入。

## 转换规则

- Standard 圆圈转换为 Mania 单点，滑条和转盘转换为长音符。
- Standard 2K 和 4K 使用转换器的纵连/交互轨道规则。
- 元数据改为 Mania、目标键数，并设置 `BeatmapSetID:-1`。输出音符使用固定的 Mania 坐标和规范化采样格式。
- 当前仅接受 osu!standard 输入。Taiko 转换仍在制作中；Mania 与 Catch 输入暂不支持。

## 在线工具

[在线转换器](https://howiehz.top/misc/tools/osu-beatmap-converter/) 支持本地批量转换、下载和谱面预览。文件只在浏览器中处理，不会上传。

## 开发

```bash
pnpm --filter osu-beatmap-converter build
pnpm --filter osu-beatmap-converter test
```

回归测试覆盖四个提供的 `.osu` 样例在所有支持的键数和 SV 模式下的输出，并检查畸形或不支持的模式声明。

## 许可证

本项目采用 [BSD 3-Clause License](./LICENSE)。
