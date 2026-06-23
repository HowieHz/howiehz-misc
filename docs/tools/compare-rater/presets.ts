export interface AspectOption {
  label: string;
  description: string;
}

export type WorkType = "动画" | "书籍" | "音乐" | "游戏";

export const workTypeOptions = [
  { label: "动画", bangumiSubjectType: 2 },
  { label: "书籍", bangumiSubjectType: 1 },
  { label: "音乐", bangumiSubjectType: 3 },
  { label: "游戏", bangumiSubjectType: 4 },
] as const satisfies readonly { label: WorkType; bangumiSubjectType: number }[];

export const fieldOptions = [
  "无细分",
  "科幻",
  "喜剧",
  "同人",
  "百合",
  "校园",
  "惊悚",
  "后宫",
  "机战",
  "悬疑",
  "恋爱",
  "奇幻",
  "推理",
  "运动",
  "耽美",
  "音乐",
  "战斗",
  "冒险",
  "萌系",
  "穿越",
  "玄幻",
  "乙女",
  "恐怖",
  "历史",
  "日常",
  "剧情",
  "武侠",
  "美食",
  "职场",
] as const;

const commonAspectOption = {
  label: "综合",
  description: "整体体验的总判断。适合不想拆维度时使用，综合该类型作品的主要评价因素。",
} as const satisfies AspectOption;

export const aspectOptionsByWorkType = {
  动画: [
    commonAspectOption,
    {
      label: "剧情&叙事",
      description:
        "作品的故事骨架。涵盖逻辑自洽、节奏把控、结构完整度、伏笔回收与信息密度。这是“讲什么”和“怎么讲”的核心。",
    },
    {
      label: "角色&演绎",
      description:
        "人物的灵魂与声音。涵盖角色塑造的立体度、成长弧光、行为合理性，以及声优的演技贴合度与情感爆发力。声优在此维度内，因为声音是让角色活起来的最后一环。",
    },
    {
      label: "画面&美术",
      description:
        "视觉的第一冲击力。涵盖作画稳定与流畅度、美术风格与光影氛围、角色道具设计感、摄影及特效与 CGI 的融合水准。",
    },
    {
      label: "音乐&音效",
      description: "听觉的沉浸网。涵盖背景音乐的情绪烘托、旋律记忆点、环境音效的真实感与爽感、主题曲与作品的契合度。",
    },
    {
      label: "演出&导演",
      description:
        "将剧本转化为影像的魔法。涵盖分镜构图的叙事效率、剪辑转场的节奏、氛围情绪的视觉营造、名场面的镜头冲击力。这是区别于漫画的动画独有维度。",
    },
    {
      label: "思想&设定",
      description:
        "作品的长尾余韵。涵盖世界观的独创性与自洽性、核心主题的探讨深度、人文关怀与现实映射，以及对观众留下的思考后劲。",
    },
  ],
  书籍: [
    commonAspectOption,
    {
      label: "叙事&结构",
      description: "故事的骨架。包括情节推进、节奏、叙事视角、时间线设计、章节布局与悬念设置。",
    },
    {
      label: "角色&深度",
      description: "人物的灵魂。涵盖角色塑造的立体度、心理真实感、成长弧光、行为动机，以及群像关系的张力。",
    },
    {
      label: "文笔&风格",
      description: "文字的质感。语言的诗性、准确性、节奏感、修辞水平，以及作者的个人风格辨识度。这是书籍独有的“画布”。",
    },
    {
      label: "氛围&意象",
      description: "无形的包裹感。涵盖文字营造的情绪气氛、画面感、象征与隐喻的运用，以及整体基调的统一性。",
    },
    {
      label: "思想&洞见",
      description: "作品的长尾余韵。涵盖核心议题的深刻性、哲学思辨、社会批判、人性洞察，以及留给读者的思考后劲。",
    },
    {
      label: "完成度&格局",
      description:
        "作品的最终答卷。涵盖整体结构的完整度、结尾的力度、长篇作品前后的一致性，以及作品的创新性、野心与影响。",
    },
  ],
  音乐: [
    commonAspectOption,
    {
      label: "旋律&和声",
      description: "音乐的“叙事线”。旋律的记忆点、美感与情绪承载力；和声进行的丰富度、色彩与张力。这是最直观的“故事”。",
    },
    {
      label: "节奏&律动",
      description: "音乐的“骨架”。节拍的复杂与巧思、速度变化、不同节奏型的配合，以及是否有令人沉浸的律动感。",
    },
    {
      label: "编曲&配器",
      description:
        "音乐的听觉画面。涵盖不同乐器音色的选择与搭配、织体层次的丰满度、段落间的动态对比，以及整体声音空间的组织。",
    },
    {
      label: "演绎&表达",
      description: "音乐的“角色与声优”。人声或器乐演奏的技术水准、音色控制、情感投入与分寸感。是让乐谱活起来的核心。",
    },
    {
      label: "制作&音质",
      description:
        "音乐的“摄影与后期”。录音质量、混音的空间感与清晰度、母带的动态处理，以及整体的听感舒适度。这是纯粹的技术维度，却直接影响沉浸感。",
    },
    {
      label: "创新&感染",
      description: "音乐的长尾后劲。涵盖风格突破、流派边界探索、情感共鸣强度，以及作品整体传达出的艺术高度。",
    },
  ],
  游戏: [
    commonAspectOption,
    {
      label: "玩法&机制",
      description: "游戏的核心骨架。规则的趣味性、操作手感、关卡与系统设计的深度与平衡性、正反馈循环的驱动力。",
    },
    {
      label: "叙事&角色",
      description: "游戏的故事灵魂。涵盖主支线剧情质量、叙事手法、角色塑造、玩家代入感，以及叙事与玩法的结合度。",
    },
    {
      label: "世界&设计",
      description:
        "游戏的舞台。涵盖世界观概念、场景与地图设计的引导性和探索感、物品设计，以及界面（UI）的清晰度与美感。",
    },
    {
      label: "视觉&氛围",
      description:
        "游戏的整体画面表现。涵盖技术层面的画质、美术风格与光影氛围、动画表现、特效质量，以及游玩过程中的视觉反馈。",
    },
    {
      label: "音频&配乐",
      description: "游戏的声音沉浸。涵盖音乐的情绪烘托与旋律记忆、环境音效的真实感、语音表现，以及操作音效反馈。",
    },
    {
      label: "体验&完成度",
      description:
        "游戏的整体打磨。涵盖技术稳定性、性能优化、交互界面的易用性、引导教学的舒适度，以及核心体验的完整性与创新性。",
    },
  ],
} as const satisfies Record<WorkType, readonly AspectOption[]>;
