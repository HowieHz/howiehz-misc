# MIDI 音游

[English](../../en/tools/midi-rhythm/) | **简体中文**

在浏览器本地读取 `.mid` 谱面，用 MIDI 键盘或 QWERTY 键盘弹奏并判定。文件不会离开当前设备。

## 功能

- **输入**：优先 Web MIDI，浏览器不支持时用 QWERTY 键盘；琴键可显示对应键位。
- **判定**：Perfect / Good / Bad / Miss 分级，阈值可调；弹错音计为 Miss。
- **模式**：判定模式（载谱弹奏并判定、录音、回放）与自由录音（无谱自由弹并录音）。
- **音源**：胶囊切换「按下时播放音源 / 自动播放音源」，可「静音音源」；音色含合成音色与本地 SoundFont（`.sf2`）。
- **辅助**：倍速、4 拍预备拍、节拍器；显示时长、小节线、音频偏移与延迟校准可调；判定阈值、倍速、音源等在演奏中修改会提示重开生效。
- **导出**：把演奏导出为 `.mid`；判定模式沿用谱面节奏，自由录音写入自选 BPM。
- **无障碍**：判定结果与状态通过 `aria-live` 播报。

## 工作流

1. 拖放或选择 `.mid` 谱面；回看之前导出的演奏时勾选「回放模式」。
2. 选择判定模式或自由录音，调整倍速（自由录音还可调节拍器 BPM）。
3. 开始后弹奏；画面显示下落音符、连击与 Perfect / Good / Bad / Miss 统计。
4. 演奏结束后「导出演奏 MIDI」下载你的弹奏 `.mid`。

## 源码结构

- [index.md](./index.md) 是工具页面。
- [MidiRhythm.vue](./MidiRhythm.vue) 提供游玩、判定、录音与导出界面。
- [presentation/controls/](./presentation/controls/) 提供可复用的开关等控件。
- [types/sfumato.d.ts](./types/sfumato.d.ts) 是 SoundFont 播放库 `sfumato` 的类型声明。
- [core/](./core/) 提供判定、时序、MIDI 解析/写出、录音、键盘映射与设置校验等可测试内核。
