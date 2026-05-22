import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ImagePlus,
  ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Star,
  Trash2,
  WandSparkles
} from "lucide-react";
import { toUserFacingError, type UserFacingError } from "../../lib/errors";
import type {
  AssistantEngine,
  AssistantAspectRatio,
  AssistantColorRecipe,
  AssistantColorRecipeKey,
  AssistantCompositionRecipe,
  AssistantCompositionRecipeKey,
  AssistantLightingRecipe,
  AssistantLightingRecipeKey,
  AssistantPromptInput,
  AssistantPromptMode,
  AssistantRecipeSource,
  AssistantPromptResult,
  AssistantReferenceRole,
  AssistantReverseContext,
  AssistantRenderQuality,
  AssistantResolution
} from "../../lib/openaiClient";
import {
  normalizeAssistantAspectRatio,
  normalizeAssistantAspectRatioText
} from "../../lib/openaiClient";
import type { AssistantFavoriteItem, AssistantHistoryItem } from "../../lib/storage";
import { Tooltip } from "./Tooltip";
import {
  collectImageFiles,
  createImportedImagesFromFiles,
  getClipboardImageFiles,
  getDataTransferImageFiles,
  hasImageFiles,
  MAX_REFERENCE_IMAGE_FILES
} from "./imageFiles";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
  referenceId?: string;
}

interface AssistantGenerateResponse {
  result: AssistantPromptResult;
  history: AssistantHistoryItem[];
}

interface NanoBananaAssistantProps {
  mixImages: CapturedImage[];
  reverseContext?: AssistantReverseContext;
  disabled: boolean;
  onGenerate: (input: AssistantPromptInput) => Promise<AssistantGenerateResponse>;
  onGetHistory: () => Promise<AssistantHistoryItem[]>;
  onRemoveHistory: (id: string) => Promise<AssistantHistoryItem[]>;
  onClearHistory: () => Promise<void>;
  onGetFavorites: () => Promise<AssistantFavoriteItem[]>;
  onAddFavorite: (
    name: string,
    input: AssistantPromptInput,
    result: AssistantPromptResult,
    referenceImages?: AssistantFavoriteItem["referenceImages"]
  ) => Promise<AssistantFavoriteItem[]>;
  onRemoveFavorite: (id: string) => Promise<AssistantFavoriteItem[]>;
  onClearFavorites: () => Promise<void>;
  onAddReferenceImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onSetReferenceImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onClearReferenceImages: () => void | Promise<unknown>;
  onReverseContextChange: (context: AssistantReverseContext | undefined) => void;
  onSendToPhotoshop: (
    input: AssistantPromptInput,
    result: AssistantPromptResult,
    targetStageId?: string
  ) => Promise<unknown>;
}

const ASSISTANT_MODES: Array<{
  value: AssistantPromptMode;
  label: string;
  hint: string;
}> = [
  {
    value: "auto",
    label: "自动判断",
    hint: "根据是否有参考图和你的描述，自动选择文生图、图文生成或编辑图片。"
  },
  {
    value: "text-to-image",
    label: "文生图",
    hint: "只根据文字想法生成可直接复制到目标模型的英文提示词。"
  },
  {
    value: "image-and-text",
    label: "图文生成",
    hint: "把参考图作为身份、风格、构图或材质依据，再结合文字生成新图提示词。"
  },
  {
    value: "editing",
    label: "编辑图片",
    hint: "面向改图任务，会强调保留或替换哪些视觉元素。"
  }
];

const REFERENCE_ROLES: Array<{
  value: AssistantReferenceRole;
  label: string;
}> = [
  { value: "identity", label: "身份参考" },
  { value: "style", label: "风格参考" },
  { value: "composition", label: "构图参考" },
  { value: "scene", label: "场景参考" },
  { value: "product", label: "产品参考" },
  { value: "text", label: "文字参考" },
  { value: "material", label: "材质参考" }
];

const ROLE_HINTS: Record<AssistantReferenceRole, string> = {
  identity: "锁定人物、角色或产品身份，避免被其它图混合替换。",
  style: "只提取画风、质感、调色和整体视觉语言。",
  composition: "参考镜头角度、版式、空间关系和构图节奏。",
  scene: "参考地点、环境、背景叙事和空间氛围。",
  product: "参考产品造型、结构、品牌文字和可识别特征。",
  text: "参考画面文字、排版、标题风格或字形要求。",
  material: "参考材质、表面处理、纹理和细节密度。"
};

const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9"
] as const;

type AssistantAspectRatioPreset = (typeof ASPECT_RATIOS)[number];

const ASPECT_RATIO_LABELS: Record<AssistantAspectRatioPreset, string> = {
  "1:1": "1:1 方图",
  "2:3": "2:3 竖版",
  "3:2": "3:2 横版",
  "3:4": "3:4 竖版",
  "4:3": "4:3 横版",
  "4:5": "4:5 竖版",
  "5:4": "5:4 横版",
  "9:16": "9:16 手机竖屏",
  "16:9": "16:9 宽屏",
  "21:9": "21:9 超宽屏"
};

const RESOLUTIONS: AssistantResolution[] = ["1K", "2K", "4K"];

const RESOLUTION_LABELS: Record<AssistantResolution, string> = {
  "1K": "1K 草图",
  "2K": "2K 推荐",
  "4K": "4K 高细节"
};

const RESOLUTION_HINTS: Record<AssistantResolution, string> = {
  "1K": "适合快速草图和低成本测试。",
  "2K": "适合默认出图，质量和速度比较均衡。",
  "4K": "适合最终海报、产品图和细节要求高的画面。"
};

const ASSISTANT_ENGINES: Array<{
  value: AssistantEngine;
  label: string;
  hint: string;
}> = [
  {
    value: "nano-banana-pro",
    label: "Nano Banana Pro",
    hint: "适合改图、图文生成和发送到 Photoshop 工作流。"
  },
  {
    value: "midjourney-v8.1",
    label: "Midjourney V8.1",
    hint: "按 V8.1 官方参数规则生成英文 MJ Prompt。"
  }
];

const RENDER_QUALITIES: Array<{
  value: AssistantRenderQuality;
  label: string;
  hint: string;
}> = [
  {
    value: "sd",
    label: "探索 SD",
    hint: "标准分辨率，速度更快，适合先探索构图。"
  },
  {
    value: "hd",
    label: "定稿 HD",
    hint: "V8.1 原生 2K，高细节，适合最终候选。"
  }
];

const PHOTOSHOP_TARGET_STAGES = [
  { value: "", label: "跟随 PS 当前阶段" },
  { value: "reference_search", label: "01 · 查找参考图" },
  { value: "sketch", label: "02 · 草图" },
  { value: "lineart", label: "03 · 线稿" },
  { value: "color_key", label: "04 · 配色" },
  { value: "refine", label: "05 · 细化" },
  { value: "asset_split", label: "06 · 单体拆分" },
  { value: "turnaround", label: "07 · 三视图" },
  { value: "ingame_preview", label: "08 · 游戏内效果图" },
  { value: "layer_split", label: "09 · 自动拆分层" }
] as const;

type PhotoshopTargetStageId =
  (typeof PHOTOSHOP_TARGET_STAGES)[number]["value"];

const ASSISTANT_DRAFT_STORAGE_KEY = "aiPromptReverseAssistantDraftV1";
const MJ_PARAMETER_PRESETS_STORAGE_KEY = "aiPromptReverseMjPresetsV1";
const MJ_COMPOSITION_PRESETS_STORAGE_KEY =
  "aiPromptReverseMjCompositionPresetsV1";
const MJ_LIGHTING_PRESETS_STORAGE_KEY = "aiPromptReverseMjLightingPresetsV1";
const MJ_COLOR_PRESETS_STORAGE_KEY = "aiPromptReverseMjColorPresetsV1";
const MAX_MJ_PARAMETER_PRESETS = 12;
const MAX_MJ_COMPOSITION_PRESETS = 24;
const MAX_MJ_LIGHTING_PRESETS = 24;
const MAX_MJ_COLOR_PRESETS = 24;

const LIGHTING_RECIPE_KEYS: AssistantLightingRecipeKey[] = [
  "shadowShapes",
  "shadowTargets",
  "shadowEdges",
  "contrast",
  "shadowSources",
  "fillLights"
];
const COMPOSITION_RECIPE_KEYS: AssistantCompositionRecipeKey[] = [
  "shotSize",
  "cameraAngle",
  "lens",
  "structure",
  "focalHierarchy",
  "artistLogic"
];
const COLOR_RECIPE_KEYS: AssistantColorRecipeKey[] = [
  "dominantPalette",
  "shadowColor",
  "highlightColor",
  "accentColor",
  "saturationContrast",
  "grading"
];

interface AssistantDraftState {
  engine: AssistantEngine;
  mode: AssistantPromptMode;
  idea: string;
  aspectRatio: AssistantAspectRatio;
  resolution: AssistantResolution;
  renderQuality: AssistantRenderQuality;
  rawEnabled: boolean;
  stylize: number;
  isStylizeDirty: boolean;
  chaos: number;
  weird: number;
  seed: string;
  negativePrompt: string;
  personalizationCode: string;
  identityLock: boolean;
  photoshopTargetStageId: PhotoshopTargetStageId;
  extraSpecs: string;
  compositionRecipeEnabled: boolean;
  autoCompositionEnabled: boolean;
  compositionSource: AssistantRecipeSource;
  compositionRecipe?: AssistantCompositionRecipe;
  lightingRecipeEnabled: boolean;
  autoLightingEnabled: boolean;
  lightingSource: AssistantRecipeSource;
  lightingRecipe?: AssistantLightingRecipe;
  colorRecipeEnabled: boolean;
  autoColorEnabled: boolean;
  colorSource: AssistantRecipeSource;
  colorRecipe?: AssistantColorRecipe;
  reverseContext?: AssistantReverseContext;
  result?: AssistantPromptResult | null;
}

interface MjParameterPreset {
  id: string;
  name: string;
  createdAt: string;
  aspectRatio?: AssistantAspectRatio;
  renderQuality: AssistantRenderQuality;
  rawEnabled: boolean;
  stylize: number;
  chaos: number;
  weird: number;
  seed: string;
  personalizationCode: string;
  negativePrompt: string;
}

interface MjRecipeToken {
  id: string;
  label: string;
  text: string;
}

interface MjRecipeMatch {
  presetId: string;
  reason: string;
  confidence: number;
  matchedKeywords: string[];
}

interface MjRecipeMatchInput {
  idea: string;
  extraSpecs: string;
  reverseContext?: AssistantReverseContext;
}

type MjCompositionSelections = Record<AssistantCompositionRecipeKey, string[]>;

interface MjCompositionTokenGroup {
  key: AssistantCompositionRecipeKey;
  label: string;
  mode: "multi" | "single";
  options: MjRecipeToken[];
}

interface MjCompositionPreset {
  id: string;
  name: string;
  createdAt: string;
  builtIn: boolean;
  selectedKeywords: MjCompositionSelections;
  customText: string;
  negativePrompt: string;
}

type MjLightingSelections = Record<AssistantLightingRecipeKey, string[]>;

interface MjLightingTokenGroup {
  key: AssistantLightingRecipeKey;
  label: string;
  mode: "multi" | "single";
  options: MjRecipeToken[];
}

interface MjLightingPreset {
  id: string;
  name: string;
  createdAt: string;
  builtIn: boolean;
  selectedKeywords: MjLightingSelections;
  customText: string;
  negativePrompt: string;
}

interface MjLightingMatch {
  presetId: string;
  reason: string;
  confidence: number;
  matchedKeywords: string[];
}

interface MjLightingMatchInput {
  idea: string;
  extraSpecs: string;
  reverseContext?: AssistantReverseContext;
}

type MjColorSelections = Record<AssistantColorRecipeKey, string[]>;

interface MjColorTokenGroup {
  key: AssistantColorRecipeKey;
  label: string;
  mode: "multi" | "single";
  options: MjRecipeToken[];
}

interface MjColorPreset {
  id: string;
  name: string;
  createdAt: string;
  builtIn: boolean;
  selectedKeywords: MjColorSelections;
  customText: string;
  negativePrompt: string;
}

const MJ_COMPOSITION_TOKEN_GROUPS: MjCompositionTokenGroup[] = [
  {
    key: "shotSize",
    label: "景别",
    mode: "single",
    options: [
      { id: "extreme-wide", label: "超远景", text: "extreme wide shot" },
      { id: "establishing", label: "建立镜头", text: "wide establishing shot" },
      { id: "medium", label: "中景", text: "medium shot" },
      { id: "close-foreground", label: "前景近景", text: "close foreground shot" },
      { id: "extreme-close-up", label: "极近特写", text: "extreme close-up" },
      { id: "over-shoulder", label: "越肩镜头", text: "over-the-shoulder shot from behind the warrior" }
    ]
  },
  {
    key: "cameraAngle",
    label: "机位",
    mode: "single",
    options: [
      { id: "low-angle", label: "低机位", text: "low-angle camera" },
      { id: "high-angle", label: "高机位", text: "high-angle camera" },
      { id: "birds-eye", label: "鸟瞰", text: "bird's-eye view" },
      { id: "worms-eye", label: "虫视角", text: "worm's-eye view" },
      { id: "slight-dutch", label: "轻微倾斜", text: "subtle tilted frame" },
      { id: "eye-level", label: "平视", text: "eye-level perspective" }
    ]
  },
  {
    key: "lens",
    label: "镜头",
    mode: "single",
    options: [
      { id: "24mm-wide", label: "24mm 广角", text: "24mm wide lens with strong foreground scale contrast" },
      { id: "30mm-medium-format", label: "30mm 中画幅", text: "30mm medium format lens with stable cinematic perspective" },
      { id: "35mm-cinema", label: "35mm 电影", text: "35mm cinema lens with natural perspective" },
      { id: "45mm", label: "45mm", text: "45mm lens with realistic character proportion" },
      { id: "telephoto", label: "长焦压缩", text: "telephoto compression stacking distant architecture and mountains" },
      { id: "ultra-wide-forced", label: "超广角强透视", text: "ultra wide-angle forced perspective" }
    ]
  },
  {
    key: "structure",
    label: "构图结构",
    mode: "multi",
    options: [
      { id: "depth-layers", label: "前中后景", text: "strong foreground-midground-background layering" },
      { id: "leading-lines", label: "引导线", text: "stone path forming strong leading lines toward the focal point" },
      { id: "diagonal", label: "对角线", text: "powerful diagonal composition" },
      { id: "thirds", label: "三分法", text: "subject placed on the right third" },
      { id: "frame-within-frame", label: "框中框", text: "frame within a frame created by ancient stone gates and dark timber beams" },
      { id: "negative-space", label: "负空间", text: "clean negative space around the small figure" },
      { id: "symmetry", label: "中轴对称", text: "strict symmetrical composition with a central stairway" },
      { id: "s-curve", label: "S 曲线", text: "S-curve composition leading the eye through water and stone bridges" },
      { id: "scale-silhouette", label: "尺度剪影", text: "tiny warrior silhouette used as scale reference" },
      { id: "foreground-occlusion", label: "前景遮挡", text: "out-of-focus foreground elements partially obscuring the frame" }
    ]
  },
  {
    key: "focalHierarchy",
    label: "焦点层级",
    mode: "multi",
    options: [
      { id: "clear-focal", label: "清晰层级", text: "clear focal hierarchy" },
      { id: "one-focal-point", label: "单一焦点", text: "one clear focal point" },
      { id: "controlled-bg", label: "背景受控", text: "controlled background detail" },
      { id: "thumbnail-readable", label: "缩略图可读", text: "large readable shapes, environment readable at thumbnail size" }
    ]
  },
  {
    key: "artistLogic",
    label: "艺术家构图逻辑",
    mode: "multi",
    options: [
      { id: "mythic-pressure", label: "神怪压迫", text: "grounded Chinese mythic composition, massive idol or monster statue dominating the frame" },
      { id: "poetic-landmark", label: "诗意地貌", text: "poetic fantasy landscape composition, one monumental landmark against vast natural terrain" },
      { id: "visual-dev-shapes", label: "大色块读形", text: "visual development composition with large readable shapes and limited deliberate detail zones" },
      { id: "cinematic-keyframe", label: "电影关键帧", text: "realistic cinematic keyframe composition, camera-first environment design, photobash realism" }
    ]
  }
];

const BUILT_IN_MJ_COMPOSITION_PRESETS: MjCompositionPreset[] = [
  createBuiltInCompositionPreset("builtin-world-establishing", "3A 武侠世界观远景", {
    shotSize: ["establishing"],
    cameraAngle: ["eye-level"],
    lens: ["telephoto"],
    structure: ["depth-layers", "negative-space", "scale-silhouette"],
    focalHierarchy: ["clear-focal", "controlled-bg"],
    artistLogic: ["poetic-landmark"]
  }, "foreground willow branches framing the shot, distant temple roofs fading into misty mountains"),
  createBuiltInCompositionPreset("builtin-boss-shoulder", "BOSS 战越肩镜头", {
    shotSize: ["over-shoulder"],
    cameraAngle: ["low-angle"],
    lens: ["ultra-wide-forced"],
    structure: ["leading-lines", "symmetry", "scale-silhouette"],
    focalHierarchy: ["clear-focal"],
    artistLogic: ["mythic-pressure"]
  }, "ruined mountain temple gate dominates the distance, foreground shoulder silhouette framing the lower right"),
  createBuiltInCompositionPreset("builtin-cliff-fortress", "山崖城寨冲击构图", {
    shotSize: ["close-foreground"],
    cameraAngle: ["slight-dutch"],
    lens: ["24mm-wide"],
    structure: ["diagonal", "leading-lines", "foreground-occlusion", "scale-silhouette"],
    focalHierarchy: ["clear-focal", "thumbnail-readable"],
    artistLogic: ["cinematic-keyframe"]
  }, "dark foreground rocks cutting across the lower frame, cliff edge cutting across the frame"),
  createBuiltInCompositionPreset("builtin-canal-s-curve", "古城水巷 S 曲线", {
    shotSize: ["medium"],
    cameraAngle: ["eye-level"],
    lens: ["35mm-cinema"],
    structure: ["s-curve", "foreground-occlusion", "depth-layers"],
    focalHierarchy: ["one-focal-point"],
    artistLogic: ["visual-dev-shapes"]
  }, "foreground umbrellas and hanging cloth signs partially obscuring the frame"),
  createBuiltInCompositionPreset("builtin-ritual-symmetry", "秘殿对称仪式构图", {
    shotSize: ["establishing"],
    cameraAngle: ["eye-level"],
    lens: ["30mm-medium-format"],
    structure: ["symmetry", "frame-within-frame", "scale-silhouette"],
    focalHierarchy: ["clear-focal", "controlled-bg"],
    artistLogic: ["mythic-pressure"]
  }, "guardian beast statues mirrored on both sides, subtle mist movement breaking the symmetry"),
  createBuiltInCompositionPreset("builtin-mythic-gate", "黑神话式神怪山门", {
    shotSize: ["over-shoulder"],
    cameraAngle: ["low-angle"],
    lens: ["24mm-wide"],
    structure: ["leading-lines", "scale-silhouette", "foreground-occlusion"],
    focalHierarchy: ["thumbnail-readable", "clear-focal"],
    artistLogic: ["mythic-pressure"]
  }, "ritual gate and stone stairs forming strong leading lines, boss arena spatial layout"),
  createBuiltInCompositionPreset("builtin-ruxing-landscape", "Ruxing Gao 式地貌奇观", {
    shotSize: ["extreme-wide"],
    cameraAngle: ["high-angle"],
    lens: ["30mm-medium-format"],
    structure: ["s-curve", "negative-space", "scale-silhouette"],
    focalHierarchy: ["thumbnail-readable", "controlled-bg"],
    artistLogic: ["poetic-landmark"]
  }, "large simple terrain shapes, winding river or canyon guiding the eye"),
  createBuiltInCompositionPreset("builtin-liang-shapes", "Liang Mark 式大形读图", {
    shotSize: ["establishing"],
    cameraAngle: ["eye-level"],
    lens: ["35mm-cinema"],
    structure: ["depth-layers", "foreground-occlusion"],
    focalHierarchy: ["thumbnail-readable", "one-focal-point", "controlled-bg"],
    artistLogic: ["visual-dev-shapes"]
  }, "graphic foreground silhouette, clean concept art color blocking"),
  createBuiltInCompositionPreset("builtin-romain-keyframe", "Romain Jouandeau 式电影关键帧", {
    shotSize: ["medium"],
    cameraAngle: ["eye-level"],
    lens: ["24mm-wide"],
    structure: ["depth-layers", "leading-lines", "foreground-occlusion"],
    focalHierarchy: ["clear-focal", "controlled-bg"],
    artistLogic: ["cinematic-keyframe"]
  }, "3D blockout-like spatial clarity, physically believable terrain and architecture layout")
];

const MJ_COMPOSITION_MATCH_RULES: Array<{
  presetId: string;
  keywords: string[];
}> = [
  { presetId: "builtin-world-establishing", keywords: ["世界观", "远景", "大景", "城市", "湖", "open-world", "establishing"] },
  { presetId: "builtin-boss-shoulder", keywords: ["boss", "BOSS", "对峙", "越肩", "arena", "怪物"] },
  { presetId: "builtin-cliff-fortress", keywords: ["山崖", "城寨", "堡垒", "冲击", "cliff", "fortress"] },
  { presetId: "builtin-canal-s-curve", keywords: ["水巷", "杭州", "夜市", "运河", "canal", "market"] },
  { presetId: "builtin-ritual-symmetry", keywords: ["秘殿", "仪式", "祭坛", "对称", "ritual", "altar"] },
  { presetId: "builtin-mythic-gate", keywords: ["黑神话", "神怪", "山门", "妖怪", "idol", "mythic"] },
  { presetId: "builtin-ruxing-landscape", keywords: ["地貌", "奇观", "白塔", "暗河", "峡谷", "landscape", "river"] },
  { presetId: "builtin-liang-shapes", keywords: ["视觉开发", "大色块", "大形", "读形", "thumbnail", "visual development"] },
  { presetId: "builtin-romain-keyframe", keywords: ["电影关键帧", "照片参考", "写实", "山谷", "森林", "keyframe", "photobash"] }
];

const MJ_COLOR_TOKEN_GROUPS: MjColorTokenGroup[] = [
  {
    key: "dominantPalette",
    label: "主色调",
    mode: "single",
    options: [
      { id: "cool-stone-gray", label: "冷灰石色", text: "cool stone-gray dominant palette" },
      { id: "ink-green", label: "墨绿竹影", text: "muted ink-green and moss-green palette" },
      { id: "black-bronze", label: "黑石青铜", text: "black stone and oxidized bronze palette" },
      { id: "white-sand", label: "白沙胡杨", text: "white sand and dry ochre poplar palette" },
      { id: "rose-gray", label: "玫瑰灰天空", text: "poetic rose-gray sky and pale limestone cliffs" },
      { id: "rainy-blue-green", label: "雨夜冷青", text: "cool blue-green rain shadows and dark timber storefronts" }
    ]
  },
  {
    key: "shadowColor",
    label: "阴影色",
    mode: "single",
    options: [
      { id: "blue-gray", label: "蓝灰暗部", text: "deep blue-gray shadows" },
      { id: "cool-shadows", label: "冷暗部", text: "deep cool shadows" },
      { id: "indigo", label: "靛蓝暗部", text: "deep indigo shadows" },
      { id: "organized-shadow", label: "有组织暗部", text: "deep organized shadow masses" },
      { id: "cool-rain", label: "冷雨阴影", text: "cool blue rain shadows" }
    ]
  },
  {
    key: "highlightColor",
    label: "高光色",
    mode: "single",
    options: [
      { id: "moon-white", label: "月白高光", text: "moon-white highlights" },
      { id: "pale-silver", label: "银白雾光", text: "pale silver mist light" },
      { id: "pale-gold", label: "干金阳光", text: "pale gold sunlight" },
      { id: "warm-amber", label: "暖灯高光", text: "warm amber lantern highlights" },
      { id: "pearl-white", label: "珍珠白高光", text: "soft pearl-white highlights" }
    ]
  },
  {
    key: "accentColor",
    label: "点缀色",
    mode: "multi",
    options: [
      { id: "dark-gold", label: "暗金点缀", text: "small muted dark-gold accents" },
      { id: "verdigris", label: "铜绿氧化", text: "verdigris green patina accents" },
      { id: "restrained-crimson", label: "克制赤色", text: "restrained crimson accents only on talismans" },
      { id: "muted-gold-city", label: "金色古城", text: "muted gold ancient city accents" },
      { id: "localized-warm", label: "局部暖光", text: "localized warm color around the focal point" },
      { id: "pale-cyan", label: "浅青幻想光", text: "small pale cyan magical accents" }
    ]
  },
  {
    key: "saturationContrast",
    label: "饱和 / 对比",
    mode: "multi",
    options: [
      { id: "desaturated", label: "低饱和", text: "desaturated cinematic grading" },
      { id: "controlled-depth", label: "克制色深", text: "rich but controlled color depth" },
      { id: "low-saturation", label: "自然低饱和", text: "low saturation" },
      { id: "high-contrast", label: "高反差低调", text: "high contrast low-key grading" },
      { id: "clean-separation", label: "明度分离", text: "clear value separation" },
      { id: "controlled-saturation", label: "饱和受控", text: "controlled saturation" }
    ]
  },
  {
    key: "grading",
    label: "电影调色",
    mode: "multi",
    options: [
      { id: "natural-material", label: "真实材质色", text: "natural material colors" },
      { id: "highlight-rolloff", label: "自然高光过渡", text: "natural highlight roll-off" },
      { id: "dark-fantasy", label: "暗黑武侠", text: "grounded Chinese dark fantasy palette" },
      { id: "concept-color-blocking", label: "概念大色块", text: "clean concept art color blocking" },
      { id: "dreamlike-grounded", label: "梦境但落地", text: "dreamlike but grounded fantasy palette" },
      { id: "wet-reflections", label: "湿石反光", text: "wet stone reflections" }
    ]
  }
];

const COLOR_NEGATIVE_PROMPT =
  "cyberpunk, neon, overly saturated colors, candy colors, colorful fantasy game UI, bright red pillars, vermilion palace paint, plastic-looking materials";

const BUILT_IN_MJ_COLOR_PRESETS: MjColorPreset[] = [
  createBuiltInColorPreset("builtin-stone-moon-gold", "冷灰石色月白暗金", {
    dominantPalette: ["cool-stone-gray"],
    shadowColor: ["blue-gray"],
    highlightColor: ["moon-white"],
    accentColor: ["dark-gold"],
    saturationContrast: ["desaturated", "controlled-depth"],
    grading: ["natural-material", "highlight-rolloff"]
  }, "aged dark timber and oxidized bronze material colors", COLOR_NEGATIVE_PROMPT),
  createBuiltInColorPreset("builtin-ink-green-silver", "墨绿竹影银白雾光", {
    dominantPalette: ["ink-green"],
    shadowColor: ["cool-shadows"],
    highlightColor: ["pale-silver"],
    accentColor: [],
    saturationContrast: ["low-saturation"],
    grading: ["natural-material"]
  }, "soft jade reflections, clean natural color harmony", COLOR_NEGATIVE_PROMPT),
  createBuiltInColorPreset("builtin-black-bronze-gold", "黑石青铜暖金宗教光", {
    dominantPalette: ["black-bronze"],
    shadowColor: ["organized-shadow"],
    highlightColor: ["warm-amber"],
    accentColor: ["verdigris", "restrained-crimson"],
    saturationContrast: ["high-contrast"],
    grading: ["dark-fantasy"]
  }, "small warm gold ritual highlights", COLOR_NEGATIVE_PROMPT),
  createBuiltInColorPreset("builtin-white-sand-poplar", "白沙胡杨干金阳光", {
    dominantPalette: ["white-sand"],
    shadowColor: ["indigo"],
    highlightColor: ["pale-gold"],
    accentColor: [],
    saturationContrast: ["desaturated"],
    grading: ["natural-material"]
  }, "washed-out sky, desaturated epic landscape grading", COLOR_NEGATIVE_PROMPT),
  createBuiltInColorPreset("builtin-rose-river-gold", "玫瑰灰天空暗河金城", {
    dominantPalette: ["rose-gray"],
    shadowColor: ["cool-shadows"],
    highlightColor: ["pearl-white"],
    accentColor: ["muted-gold-city", "pale-cyan"],
    saturationContrast: ["controlled-depth", "clean-separation"],
    grading: ["dreamlike-grounded"]
  }, "dark river reflections, soft atmospheric color gradients", COLOR_NEGATIVE_PROMPT),
  createBuiltInColorPreset("builtin-rain-lantern", "雨夜暖灯冷青街巷", {
    dominantPalette: ["rainy-blue-green"],
    shadowColor: ["cool-rain"],
    highlightColor: ["warm-amber"],
    accentColor: ["localized-warm"],
    saturationContrast: ["controlled-saturation"],
    grading: ["wet-reflections", "highlight-rolloff"]
  }, "dark timber storefronts, controlled color spill on wet stone", COLOR_NEGATIVE_PROMPT)
];

const MJ_COLOR_MATCH_RULES: Array<{
  presetId: string;
  keywords: string[];
}> = [
  { presetId: "builtin-stone-moon-gold", keywords: ["山门", "城寨", "遗迹", "石", "寺", "fortress", "stone"] },
  { presetId: "builtin-ink-green-silver", keywords: ["竹林", "山寺", "森林", "潮湿", "bamboo", "forest"] },
  { presetId: "builtin-black-bronze-gold", keywords: ["boss", "BOSS", "秘殿", "祭坛", "青铜", "仪式", "ritual", "bronze"] },
  { presetId: "builtin-white-sand-poplar", keywords: ["白沙", "沙漠", "胡杨", "雪", "边塞", "desert", "snow"] },
  { presetId: "builtin-rose-river-gold", keywords: ["梦境", "暗河", "白塔", "古城", "奇观", "river", "pagoda"] },
  { presetId: "builtin-rain-lantern", keywords: ["雨夜", "灯笼", "夜市", "水巷", "杭州", "rain", "lantern", "canal"] }
];


const MJ_LIGHTING_TOKEN_GROUPS: MjLightingTokenGroup[] = [
  {
    key: "shadowShapes",
    label: "阴影形状",
    mode: "multi",
    options: [
      { id: "long-diagonal", label: "长斜影", text: "long diagonal shadows" },
      { id: "broken-bamboo-leaf", label: "竹叶碎影", text: "broken bamboo leaf shadows" },
      { id: "dappled", label: "斑驳光影", text: "dappled shadows" },
      { id: "lattice", label: "窗棂影", text: "lattice shadows" },
      { id: "blocky-architecture", label: "建筑大块影", text: "blocky architectural shadows" },
      { id: "blade-like", label: "刀锋细影", text: "thin blade-like shadow" },
      { id: "negative-mass", label: "大块暗部", text: "large negative shadow mass" }
    ]
  },
  {
    key: "shadowTargets",
    label: "落点",
    mode: "multi",
    options: [
      { id: "face", label: "脸部", text: "across the warrior's face" },
      { id: "robe", label: "衣服", text: "across the robe and fabric folds" },
      { id: "wet-stone", label: "湿石板", text: "across the wet stone path" },
      { id: "wall", label: "墙面", text: "projected onto the ancient wall" },
      { id: "steps", label: "台阶", text: "falling across wet stone steps" },
      { id: "snow", label: "雪地", text: "stretching over the white snowfield" },
      { id: "water", label: "水面", text: "reflected across still water" },
      { id: "mist-bg", label: "雾中背景", text: "fading into the misty background" }
    ]
  },
  {
    key: "shadowEdges",
    label: "边缘",
    mode: "single",
    options: [
      { id: "hard-edged", label: "硬边", text: "hard-edged" },
      { id: "soft-edged", label: "软边", text: "soft-edged" },
      { id: "feathered", label: "羽化边缘", text: "feathered-edge" },
      { id: "crisp-falloff", label: "清晰衰减", text: "crisp falloff" }
    ]
  },
  {
    key: "contrast",
    label: "明暗比例",
    mode: "single",
    options: [
      { id: "half-face", label: "半脸阴影", text: "half of the face hidden in deep cool shadow" },
      { id: "bright-dark-zones", label: "明暗分区", text: "dividing the scene into bright and dark zones" },
      { id: "large-dark-mass", label: "大面积暗部", text: "a large negative shadow mass swallowing one side of the frame" },
      { id: "small-highlights", label: "小面积高光", text: "small bright highlights catching the wet material edges" }
    ]
  },
  {
    key: "shadowSources",
    label: "投影来源",
    mode: "multi",
    options: [
      { id: "bamboo-leaves", label: "竹叶", text: "cast by bamboo leaves" },
      { id: "roof-eaves", label: "屋檐", text: "cast by roof eaves" },
      { id: "lattice-window", label: "窗棂", text: "from carved lattice windows" },
      { id: "wooden-screen", label: "木雕屏风", text: "from carved wooden screens" },
      { id: "stone-gate", label: "城门", text: "cast by a massive stone gate" },
      { id: "tree-branches", label: "树枝", text: "cast by bare tree branches" },
      { id: "statue", label: "雕像", text: "cast by ancient statues" }
    ]
  },
  {
    key: "fillLights",
    label: "补光",
    mode: "multi",
    options: [
      { id: "warm-rim", label: "暖边缘光", text: "thin warm rim light outlining the shoulders and weapon" },
      { id: "cool-ambient", label: "冷环境光", text: "cool blue ambient shadows in the background" },
      { id: "water-highlights", label: "水面高光", text: "moon-white highlights on water reflections" },
      { id: "small-highlights", label: "小面积高光", text: "small controlled highlights separating the silhouette from darkness" }
    ]
  }
];

const BUILT_IN_MJ_LIGHTING_PRESETS: MjLightingPreset[] = [
  createBuiltInLightingPreset("builtin-bamboo-wuxia", "竹林武侠", {
    shadowShapes: ["broken-bamboo-leaf", "long-diagonal"],
    shadowTargets: ["robe", "wet-stone", "mist-bg"],
    shadowEdges: ["soft-edged"],
    contrast: ["half-face"],
    shadowSources: ["bamboo-leaves"],
    fillLights: ["warm-rim"]
  }, "soft-edged shadows fading into the fog", "red pillars, bright red columns, red lacquered architecture"),
  createBuiltInLightingPreset("builtin-hangzhou-temple", "古杭州水边寺院", {
    shadowShapes: ["lattice"],
    shadowTargets: ["steps", "water", "mist-bg"],
    shadowEdges: ["crisp-falloff"],
    contrast: ["bright-dark-zones"],
    shadowSources: ["lattice-window", "roof-eaves"],
    fillLights: ["water-highlights", "cool-ambient"]
  }, "deep shadow pockets under black tiled eaves", "red lacquered architecture, neon, sci-fi"),
  createBuiltInLightingPreset("builtin-night-market", "古城夜市", {
    shadowShapes: ["blocky-architecture"],
    shadowTargets: ["wet-stone", "wall"],
    shadowEdges: ["soft-edged"],
    contrast: ["small-highlights"],
    shadowSources: ["roof-eaves"],
    fillLights: ["cool-ambient", "small-highlights"]
  }, "warm lantern rectangles reflected in puddles, deep shadow pockets beneath wooden balconies", "modern signage, neon cyberpunk, UI"),
  createBuiltInLightingPreset("builtin-ruins-boss", "遗迹废墟 / BOSS 场", {
    shadowShapes: ["blocky-architecture", "blade-like", "negative-mass"],
    shadowTargets: ["face", "wall", "wet-stone"],
    shadowEdges: ["hard-edged"],
    contrast: ["large-dark-mass"],
    shadowSources: ["stone-gate", "statue"],
    fillLights: ["warm-rim", "cool-ambient"]
  }, "massive stone gate shadows dividing the arena into bright and dark zones", "blood, gore, red lacquered architecture, text, logo"),
  createBuiltInLightingPreset("builtin-snowfield", "雪景大场面", {
    shadowShapes: ["long-diagonal", "negative-mass"],
    shadowTargets: ["snow"],
    shadowEdges: ["soft-edged"],
    contrast: ["small-highlights"],
    shadowSources: ["tree-branches"],
    fillLights: ["cool-ambient", "small-highlights"]
  }, "subtle contact shadows under boots on snow, small dark figure silhouette isolated in open negative space", "warm desert, tropical forest, neon"),
  createBuiltInLightingPreset("builtin-ritual-interior", "室内秘殿", {
    shadowShapes: ["lattice", "blocky-architecture", "negative-mass"],
    shadowTargets: ["wall", "wet-stone"],
    shadowEdges: ["hard-edged"],
    contrast: ["large-dark-mass"],
    shadowSources: ["wooden-screen", "statue"],
    fillLights: ["warm-rim"]
  }, "red ritual light blocked into rectangular shadow zones, gobo shadows projected onto the stone floor", "modern interior, office light, UI, logo")
];

const MJ_LIGHTING_MATCH_RULES: Array<{
  presetId: string;
  keywords: string[];
}> = [
  {
    presetId: "builtin-bamboo-wuxia",
    keywords: ["竹林", "竹", "bamboo", "forest"]
  },
  {
    presetId: "builtin-hangzhou-temple",
    keywords: ["杭州", "湖", "水边", "寺", "桥", "water", "temple", "lake"]
  },
  {
    presetId: "builtin-night-market",
    keywords: ["夜市", "灯笼", "街市", "lantern", "market"]
  },
  {
    presetId: "builtin-ruins-boss",
    keywords: ["废墟", "boss", "BOSS", "遗迹", "arena", "statue", "monster"]
  },
  {
    presetId: "builtin-snowfield",
    keywords: ["雪", "雪山", "堡垒", "snow", "fortress"]
  },
  {
    presetId: "builtin-ritual-interior",
    keywords: ["室内", "秘殿", "祭坛", "仪式", "altar", "ritual", "interior"]
  }
];

export function NanoBananaAssistant({
  mixImages,
  reverseContext,
  disabled,
  onGenerate,
  onGetHistory,
  onRemoveHistory,
  onClearHistory,
  onGetFavorites,
  onAddFavorite,
  onRemoveFavorite,
  onClearFavorites,
  onAddReferenceImages,
  onSetReferenceImages,
  onClearReferenceImages,
  onReverseContextChange,
  onSendToPhotoshop
}: NanoBananaAssistantProps) {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const assistantDraft = useMemo(readAssistantDraftState, []);
  const [engine, setEngine] = useState<AssistantEngine>(
    assistantDraft?.engine ?? "nano-banana-pro"
  );
  const [mode, setMode] = useState<AssistantPromptMode>(
    assistantDraft?.mode ?? "auto"
  );
  const [idea, setIdea] = useState(assistantDraft?.idea ?? "");
  const [aspectRatio, setAspectRatio] = useState<AssistantAspectRatio>(
    assistantDraft?.aspectRatio ?? "16:9"
  );
  const [resolution, setResolution] = useState<AssistantResolution>(
    assistantDraft?.resolution ?? "2K"
  );
  const [renderQuality, setRenderQuality] = useState<AssistantRenderQuality>(
    assistantDraft?.renderQuality ?? "hd"
  );
  const [rawEnabled, setRawEnabled] = useState(assistantDraft?.rawEnabled ?? true);
  const [stylize, setStylize] = useState(assistantDraft?.stylize ?? 120);
  const [isStylizeDirty, setIsStylizeDirty] = useState(
    assistantDraft?.isStylizeDirty ?? false
  );
  const [chaos, setChaos] = useState(assistantDraft?.chaos ?? 0);
  const [weird, setWeird] = useState(assistantDraft?.weird ?? 0);
  const [seed, setSeed] = useState(assistantDraft?.seed ?? "");
  const [negativePrompt, setNegativePrompt] = useState(
    assistantDraft?.negativePrompt ?? ""
  );
  const [personalizationCode, setPersonalizationCode] = useState(
    assistantDraft?.personalizationCode ?? ""
  );
  const [identityLock, setIdentityLock] = useState(
    assistantDraft?.identityLock ?? false
  );
  const [photoshopTargetStageId, setPhotoshopTargetStageId] =
    useState<PhotoshopTargetStageId>(
      assistantDraft?.photoshopTargetStageId ?? ""
  );
  const [extraSpecs, setExtraSpecs] = useState(assistantDraft?.extraSpecs ?? "");
  const [compositionRecipeEnabled, setCompositionRecipeEnabled] = useState(
    assistantDraft?.compositionRecipeEnabled ?? false
  );
  const [autoCompositionEnabled, setAutoCompositionEnabled] = useState(
    assistantDraft?.autoCompositionEnabled ?? true
  );
  const [compositionSource, setCompositionSource] = useState<AssistantRecipeSource>(
    assistantDraft?.compositionSource ??
      (assistantDraft?.compositionRecipe?.promptText ? "manual" : "auto")
  );
  const [compositionPresetId, setCompositionPresetId] = useState(
    assistantDraft?.compositionRecipe?.presetId ?? ""
  );
  const [compositionSelections, setCompositionSelections] =
    useState<MjCompositionSelections>(() =>
      createCompositionSelectionsFromRecipe(assistantDraft?.compositionRecipe)
    );
  const [compositionCustomText, setCompositionCustomText] = useState(
    assistantDraft?.compositionRecipe?.customText ?? ""
  );
  const [compositionNegativePrompt, setCompositionNegativePrompt] = useState(
    assistantDraft?.compositionRecipe?.negativePrompt ?? ""
  );
  const [lightingRecipeEnabled, setLightingRecipeEnabled] = useState(
    assistantDraft?.lightingRecipeEnabled ??
      Boolean(assistantDraft?.lightingRecipe?.promptText)
  );
  const [autoLightingEnabled, setAutoLightingEnabled] = useState(
    assistantDraft?.autoLightingEnabled ?? true
  );
  const [lightingSource, setLightingSource] = useState<AssistantRecipeSource>(
    assistantDraft?.lightingSource ??
      (assistantDraft?.lightingRecipe?.promptText ? "manual" : "auto")
  );
  const [lightingPresetId, setLightingPresetId] = useState(
    assistantDraft?.lightingRecipe?.presetId ?? ""
  );
  const [lightingSelections, setLightingSelections] =
    useState<MjLightingSelections>(() =>
      createLightingSelectionsFromRecipe(assistantDraft?.lightingRecipe)
    );
  const [lightingCustomText, setLightingCustomText] = useState(
    assistantDraft?.lightingRecipe?.customText ?? ""
  );
  const [lightingNegativePrompt, setLightingNegativePrompt] = useState(
    assistantDraft?.lightingRecipe?.negativePrompt ?? ""
  );
  const [colorRecipeEnabled, setColorRecipeEnabled] = useState(
    assistantDraft?.colorRecipeEnabled ?? false
  );
  const [autoColorEnabled, setAutoColorEnabled] = useState(
    assistantDraft?.autoColorEnabled ?? true
  );
  const [colorSource, setColorSource] = useState<AssistantRecipeSource>(
    assistantDraft?.colorSource ??
      (assistantDraft?.colorRecipe?.promptText ? "manual" : "auto")
  );
  const [colorPresetId, setColorPresetId] = useState(
    assistantDraft?.colorRecipe?.presetId ?? ""
  );
  const [colorSelections, setColorSelections] = useState<MjColorSelections>(() =>
    createColorSelectionsFromRecipe(assistantDraft?.colorRecipe)
  );
  const [colorCustomText, setColorCustomText] = useState(
    assistantDraft?.colorRecipe?.customText ?? ""
  );
  const [colorNegativePrompt, setColorNegativePrompt] = useState(
    assistantDraft?.colorRecipe?.negativePrompt ?? ""
  );
  const [fallbackReverseContext, setFallbackReverseContext] = useState<
    AssistantReverseContext | undefined
  >(assistantDraft?.reverseContext);
  const [referenceRoles, setReferenceRoles] = useState<
    Record<string, AssistantReferenceRole>
  >({});
  const [result, setResult] = useState<AssistantPromptResult | null>(
    assistantDraft?.result ?? null
  );
  const [history, setHistory] = useState<AssistantHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<AssistantFavoriteItem[]>([]);
  const [libraryTab, setLibraryTab] = useState<"favorites" | "history">(
    "favorites"
  );
  const [error, setError] = useState<UserFacingError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingReferences, setIsReadingReferences] = useState(false);
  const [isReferenceDropActive, setIsReferenceDropActive] = useState(false);
  const [isSendingToPhotoshop, setIsSendingToPhotoshop] = useState(false);
  const [draggedReferenceIndex, setDraggedReferenceIndex] = useState<number | null>(
    null
  );
  const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<
    number | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [sentToPhotoshop, setSentToPhotoshop] = useState(false);
  const [mjPresets, setMjPresets] = useState<MjParameterPreset[]>(
    readMjParameterPresets
  );
  const [selectedMjPresetId, setSelectedMjPresetId] = useState("");
  const [customLightingPresets, setCustomLightingPresets] = useState<
    MjLightingPreset[]
  >(readMjLightingPresets);
  const [customCompositionPresets, setCustomCompositionPresets] = useState<
    MjCompositionPreset[]
  >(readMjCompositionPresets);
  const [customColorPresets, setCustomColorPresets] = useState<MjColorPreset[]>(
    readMjColorPresets
  );
  const activeReverseContext = reverseContext ?? fallbackReverseContext;
  const isMidjourney = engine === "midjourney-v8.1";
  const compositionPresets = useMemo(
    () => [...BUILT_IN_MJ_COMPOSITION_PRESETS, ...customCompositionPresets],
    [customCompositionPresets]
  );
  const lightingPresets = useMemo(
    () => [...BUILT_IN_MJ_LIGHTING_PRESETS, ...customLightingPresets],
    [customLightingPresets]
  );
  const colorPresets = useMemo(
    () => [...BUILT_IN_MJ_COLOR_PRESETS, ...customColorPresets],
    [customColorPresets]
  );
  const autoCompositionMatch = useMemo(
    () =>
      matchMjPreset(
        {
          idea,
          extraSpecs,
          reverseContext: activeReverseContext
        },
        MJ_COMPOSITION_MATCH_RULES
      ),
    [activeReverseContext, extraSpecs, idea]
  );
  const autoCompositionPreset = autoCompositionMatch
    ? BUILT_IN_MJ_COMPOSITION_PRESETS.find(
        (preset) => preset.id === autoCompositionMatch.presetId
      )
    : undefined;
  const isAutoCompositionActive =
    isMidjourney &&
    autoCompositionEnabled &&
    compositionSource === "auto" &&
    Boolean(autoCompositionPreset);
  const effectiveCompositionSelections = isAutoCompositionActive
    ? autoCompositionPreset!.selectedKeywords
    : compositionSelections;
  const effectiveCompositionCustomText = isAutoCompositionActive
    ? autoCompositionPreset!.customText
    : compositionCustomText;
  const effectiveCompositionNegativePrompt = isAutoCompositionActive
    ? autoCompositionPreset!.negativePrompt
    : compositionNegativePrompt;
  const effectiveCompositionPreset = isAutoCompositionActive
    ? autoCompositionPreset
    : compositionPresets.find((preset) => preset.id === compositionPresetId);
  const compositionPromptPreview = useMemo(
    () =>
      buildMjCompositionPrompt(
        effectiveCompositionSelections,
        effectiveCompositionCustomText
      ),
    [effectiveCompositionCustomText, effectiveCompositionSelections]
  );
  const currentCompositionRecipe = useMemo<AssistantCompositionRecipe | undefined>(() => {
    if (!compositionPromptPreview) {
      return undefined;
    }

    return {
      name: effectiveCompositionPreset?.name ?? "自定义构图",
      presetId: effectiveCompositionPreset?.id || compositionPresetId || undefined,
      promptText: compositionPromptPreview,
      negativePrompt: effectiveCompositionNegativePrompt.trim() || undefined,
      customText: effectiveCompositionCustomText.trim() || undefined,
      selectedKeywords: createCompositionRecipeKeywords(
        effectiveCompositionSelections
      )
    };
  }, [
    compositionPresetId,
    compositionPromptPreview,
    effectiveCompositionCustomText,
    effectiveCompositionNegativePrompt,
    effectiveCompositionPreset?.id,
    effectiveCompositionPreset?.name,
    effectiveCompositionSelections
  ]);
  const activeCompositionRecipe =
    isMidjourney && compositionRecipeEnabled
      ? currentCompositionRecipe
      : undefined;
  const selectedCustomCompositionPreset = customCompositionPresets.find(
    (preset) => preset.id === compositionPresetId
  );
  const autoLightingMatch = useMemo(
    () =>
      matchMjLightingPreset({
        idea,
        extraSpecs,
        reverseContext: activeReverseContext
      }),
    [activeReverseContext, extraSpecs, idea]
  );
  const autoLightingPreset = autoLightingMatch
    ? BUILT_IN_MJ_LIGHTING_PRESETS.find(
        (preset) => preset.id === autoLightingMatch.presetId
      )
    : undefined;
  const isAutoLightingActive =
    isMidjourney &&
    autoLightingEnabled &&
    lightingSource === "auto" &&
    Boolean(autoLightingPreset);
  const effectiveLightingSelections = isAutoLightingActive
    ? autoLightingPreset!.selectedKeywords
    : lightingSelections;
  const effectiveLightingCustomText = isAutoLightingActive
    ? autoLightingPreset!.customText
    : lightingCustomText;
  const effectiveLightingNegativePrompt = isAutoLightingActive
    ? autoLightingPreset!.negativePrompt
    : lightingNegativePrompt;
  const effectiveLightingPreset = isAutoLightingActive
    ? autoLightingPreset
    : lightingPresets.find((preset) => preset.id === lightingPresetId);
  const lightingPromptPreview = useMemo(
    () =>
      buildMjLightingPrompt(
        effectiveLightingSelections,
        effectiveLightingCustomText
      ),
    [effectiveLightingCustomText, effectiveLightingSelections]
  );
  const currentLightingRecipe = useMemo<AssistantLightingRecipe | undefined>(() => {
    if (!lightingPromptPreview) {
      return undefined;
    }

    return {
      name: effectiveLightingPreset?.name ?? "自定义光影",
      presetId: effectiveLightingPreset?.id || lightingPresetId || undefined,
      promptText: lightingPromptPreview,
      negativePrompt: effectiveLightingNegativePrompt.trim() || undefined,
      customText: effectiveLightingCustomText.trim() || undefined,
      selectedKeywords: createLightingRecipeKeywords(effectiveLightingSelections)
    };
  }, [
    effectiveLightingCustomText,
    effectiveLightingNegativePrompt,
    effectiveLightingPreset?.id,
    effectiveLightingPreset?.name,
    effectiveLightingSelections,
    lightingPresetId,
    lightingPromptPreview
  ]);
  const activeLightingRecipe =
    isMidjourney &&
    lightingRecipeEnabled
      ? currentLightingRecipe
      : undefined;
  const selectedCustomLightingPreset = customLightingPresets.find(
    (preset) => preset.id === lightingPresetId
  );
  const autoColorMatch = useMemo(
    () =>
      matchMjPreset(
        {
          idea,
          extraSpecs,
          reverseContext: activeReverseContext
        },
        MJ_COLOR_MATCH_RULES
      ),
    [activeReverseContext, extraSpecs, idea]
  );
  const autoColorPreset = autoColorMatch
    ? BUILT_IN_MJ_COLOR_PRESETS.find(
        (preset) => preset.id === autoColorMatch.presetId
      )
    : undefined;
  const isAutoColorActive =
    isMidjourney &&
    autoColorEnabled &&
    colorSource === "auto" &&
    Boolean(autoColorPreset);
  const effectiveColorSelections = isAutoColorActive
    ? autoColorPreset!.selectedKeywords
    : colorSelections;
  const effectiveColorCustomText = isAutoColorActive
    ? autoColorPreset!.customText
    : colorCustomText;
  const effectiveColorNegativePrompt = isAutoColorActive
    ? autoColorPreset!.negativePrompt
    : colorNegativePrompt;
  const effectiveColorPreset = isAutoColorActive
    ? autoColorPreset
    : colorPresets.find((preset) => preset.id === colorPresetId);
  const colorPromptPreview = useMemo(
    () =>
      buildMjColorPrompt(
        effectiveColorSelections,
        effectiveColorCustomText
      ),
    [effectiveColorCustomText, effectiveColorSelections]
  );
  const currentColorRecipe = useMemo<AssistantColorRecipe | undefined>(() => {
    if (!colorPromptPreview) {
      return undefined;
    }

    return {
      name: effectiveColorPreset?.name ?? "自定义配色",
      presetId: effectiveColorPreset?.id || colorPresetId || undefined,
      promptText: colorPromptPreview,
      negativePrompt: effectiveColorNegativePrompt.trim() || undefined,
      customText: effectiveColorCustomText.trim() || undefined,
      selectedKeywords: createColorRecipeKeywords(effectiveColorSelections)
    };
  }, [
    colorPresetId,
    colorPromptPreview,
    effectiveColorCustomText,
    effectiveColorNegativePrompt,
    effectiveColorPreset?.id,
    effectiveColorPreset?.name,
    effectiveColorSelections
  ]);
  const activeColorRecipe =
    isMidjourney && colorRecipeEnabled
      ? currentColorRecipe
      : undefined;
  const selectedCustomColorPreset = customColorPresets.find(
    (preset) => preset.id === colorPresetId
  );

  useEffect(() => {
    void onGetHistory().then(setHistory).catch(() => setHistory([]));
  }, [onGetHistory]);

  useEffect(() => {
    void onGetFavorites().then(setFavorites).catch(() => setFavorites([]));
  }, [onGetFavorites]);

  useEffect(() => {
    if (reverseContext) {
      setFallbackReverseContext(reverseContext);
    }
  }, [reverseContext]);

  useEffect(() => {
    writeAssistantDraftState({
      engine,
      mode,
      idea,
      aspectRatio,
      resolution,
      renderQuality,
      rawEnabled,
      stylize,
      isStylizeDirty,
      chaos,
      weird,
      seed,
      negativePrompt,
      personalizationCode,
      identityLock,
      photoshopTargetStageId,
      extraSpecs,
      compositionRecipeEnabled,
      autoCompositionEnabled,
      compositionSource,
      compositionRecipe: currentCompositionRecipe,
      lightingRecipeEnabled,
      autoLightingEnabled,
      lightingSource,
      lightingRecipe: currentLightingRecipe,
      colorRecipeEnabled,
      autoColorEnabled,
      colorSource,
      colorRecipe: currentColorRecipe,
      reverseContext: activeReverseContext,
      result
    });
  }, [
    activeReverseContext,
    aspectRatio,
    autoColorEnabled,
    autoCompositionEnabled,
    autoLightingEnabled,
    chaos,
    colorRecipeEnabled,
    colorSource,
    compositionRecipeEnabled,
    compositionSource,
    currentColorRecipe,
    currentCompositionRecipe,
    currentLightingRecipe,
    engine,
    extraSpecs,
    idea,
    identityLock,
    isStylizeDirty,
    lightingRecipeEnabled,
    lightingSource,
    mode,
    negativePrompt,
    personalizationCode,
    photoshopTargetStageId,
    rawEnabled,
    renderQuality,
    resolution,
    result,
    seed,
    stylize,
    weird
  ]);

  useEffect(() => {
    writeMjParameterPresets(mjPresets);
  }, [mjPresets]);

  useEffect(() => {
    writeMjCompositionPresets(customCompositionPresets);
  }, [customCompositionPresets]);

  useEffect(() => {
    writeMjLightingPresets(customLightingPresets);
  }, [customLightingPresets]);

  useEffect(() => {
    writeMjColorPresets(customColorPresets);
  }, [customColorPresets]);

  useEffect(() => {
    setReferenceRoles((current) => {
      const activeKeys = new Set(
        mixImages.map((image, index) => getReferenceRoleKey(image, index))
      );
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => activeKeys.has(key))
      ) as Record<string, AssistantReferenceRole>;

      mixImages.forEach((image, index) => {
        const roleKey = getReferenceRoleKey(image, index);

        if (!next[roleKey]) {
          next[roleKey] = getDefaultReferenceRole(index);
        }
      });

      return next;
    });
  }, [mixImages]);

  const remainingReferenceSlots = Math.max(
    0,
    MAX_REFERENCE_IMAGE_FILES - mixImages.length
  );
  const canAddReferenceImages =
    remainingReferenceSlots > 0 && !disabled && !isReadingReferences;

  const references = useMemo(
    () =>
      mixImages.map((image, index) => {
        const roleKey = getReferenceRoleKey(image, index);

        return {
          imageUrl: image.url,
          sourceImageUrl: image.url,
          sourcePageUrl: image.sourcePageUrl,
          sourceTitle: image.sourceTitle,
          label: `图片 ${index + 1}`,
          role: referenceRoles[roleKey] ?? getDefaultReferenceRole(index)
        };
      }),
    [mixImages, referenceRoles]
  );

  const normalizedMjAspectRatio = normalizeAssistantAspectRatio(aspectRatio);
  const aspectRatioError =
    isMidjourney && !normalizedMjAspectRatio
      ? "MJ 画幅比例必须是正整数:正整数，例如 7:3、85:110 或 1920:1080。"
      : "";
  const displayAspectRatio = getAssistantAspectRatioForEngine(engine, aspectRatio);
  const hasReverseContext = Boolean(activeReverseContext);
  const canGenerate =
    (idea.trim().length > 0 || hasReverseContext) &&
    !aspectRatioError &&
    !isLoading &&
    !disabled;
  const currentEngine = ASSISTANT_ENGINES.find((item) => item.value === engine);
  const currentMode = ASSISTANT_MODES.find((item) => item.value === mode);
  const currentRenderQuality =
    RENDER_QUALITIES.find((item) => item.value === renderQuality) ??
    {
      value: "hd" as const,
      label: "定稿 HD",
      hint: "V8.1 原生 2K，高细节，适合最终候选。"
    };
  const activeQualityHint = isMidjourney
    ? currentRenderQuality.hint
    : RESOLUTION_HINTS[resolution];
  const photoshopTargetStage =
    PHOTOSHOP_TARGET_STAGES.find((stage) => stage.value === photoshopTargetStageId) ??
    PHOTOSHOP_TARGET_STAGES[0];
  const photoshopTransferHint = sentToPhotoshop
    ? "已发送，回到 PS 点击接收并填入"
    : result?.finalPrompt
      ? "选择阶段后发送到本机 Photoshop"
      : "生成提示词后可发送到 Photoshop";
  const photoshopSendLabel = isSendingToPhotoshop
    ? "发送中"
    : sentToPhotoshop ? "已发送" : "发送到 PS";

  useEffect(() => {
    if (!isMidjourney || isStylizeDirty) {
      return;
    }

    setStylize(getMidjourneyStylizePreset(aspectRatio, renderQuality));
  }, [aspectRatio, isMidjourney, isStylizeDirty, renderQuality]);

  async function generatePrompt() {
    if (!idea.trim() && !activeReverseContext) {
      setError({
        code: "missing_config",
        title: "缺少想法",
        message: isMidjourney
          ? "先写下你想让 Midjourney V8.1 生成什么。"
          : "先写下你想让 Nano Banana Pro 生成或修改什么。",
        canRetry: false
      });
      return;
    }

    if (aspectRatioError) {
      setError({
        code: "missing_config",
        title: "画幅比例无效",
        message: aspectRatioError,
        canRetry: false
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await onGenerate(createAssistantInput());

      setResult(response.result);
      setHistory(response.history);
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsLoading(false);
    }
  }

  async function copyFinalPrompt() {
    if (!result?.finalPrompt) {
      return;
    }

    await navigator.clipboard.writeText(result.finalPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function sendToPhotoshop() {
    if (!result?.finalPrompt) {
      return;
    }

    setIsSendingToPhotoshop(true);
    setError(null);

    try {
      await onSendToPhotoshop(createAssistantInput(), result, photoshopTargetStageId);
      setSentToPhotoshop(true);
      window.setTimeout(() => setSentToPhotoshop(false), 1800);
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsSendingToPhotoshop(false);
    }
  }

  async function refreshHistory() {
    setHistory(await onGetHistory());
  }

  async function refreshFavorites() {
    setFavorites(await onGetFavorites());
  }

  async function removeHistory(id: string) {
    setHistory(await onRemoveHistory(id));
  }

  async function removeFavorite(id: string) {
    setFavorites(await onRemoveFavorite(id));
  }

  async function clearHistory() {
    await onClearHistory();
    setHistory([]);
  }

  async function clearFavorites() {
    await onClearFavorites();
    setFavorites([]);
  }

  function createAssistantInput(): AssistantPromptInput {
    return {
      engine,
      mode,
      idea,
      references,
      aspectRatio: getAssistantAspectRatioForEngine(engine, aspectRatio),
      resolution,
      identityLock,
      reverseContext: activeReverseContext,
      extraSpecs: extraSpecs.trim() || undefined,
      rawEnabled: isMidjourney ? rawEnabled : undefined,
      renderQuality: isMidjourney ? renderQuality : undefined,
      stylize: isMidjourney ? stylize : undefined,
      chaos: isMidjourney ? chaos : undefined,
      weird: isMidjourney ? weird : undefined,
      seed: isMidjourney ? seed.trim() || undefined : undefined,
      negativePrompt: isMidjourney ? negativePrompt.trim() || undefined : undefined,
      personalizationCode: isMidjourney
        ? personalizationCode.trim() || undefined
        : undefined,
      compositionRecipe: isMidjourney ? activeCompositionRecipe : undefined,
      compositionRecipeEnabled: isMidjourney
        ? compositionRecipeEnabled
        : undefined,
      autoCompositionEnabled: isMidjourney ? autoCompositionEnabled : undefined,
      compositionSource: isMidjourney ? compositionSource : undefined,
      lightingRecipe: isMidjourney ? activeLightingRecipe : undefined,
      lightingRecipeEnabled: isMidjourney ? lightingRecipeEnabled : undefined,
      autoLightingEnabled: isMidjourney ? autoLightingEnabled : undefined,
      lightingSource: isMidjourney ? lightingSource : undefined,
      colorRecipe: isMidjourney ? activeColorRecipe : undefined,
      colorRecipeEnabled: isMidjourney ? colorRecipeEnabled : undefined,
      autoColorEnabled: isMidjourney ? autoColorEnabled : undefined,
      colorSource: isMidjourney ? colorSource : undefined
    };
  }

  function updateReverseContext(context: AssistantReverseContext | undefined) {
    setFallbackReverseContext(context);
    onReverseContextChange(context);
  }

  function clearReverseContext() {
    updateReverseContext(undefined);
  }

  function saveCurrentMjPreset() {
    const presetAspectRatio = normalizeAssistantAspectRatio(aspectRatio);

    if (!presetAspectRatio) {
      setError({
        code: "missing_config",
        title: "画幅比例无效",
        message: "MJ 画幅比例必须是正整数:正整数，例如 7:3、85:110 或 1920:1080。",
        canRetry: false
      });
      return;
    }

    const fallbackName = `MJ ${presetAspectRatio} ${renderQuality.toUpperCase()} S${stylize} C${chaos}`;
    const name = window.prompt("预设名称", fallbackName)?.trim();

    if (!name) {
      return;
    }

    const preset: MjParameterPreset = {
      id: createPresetId(),
      name,
      createdAt: new Date().toISOString(),
      aspectRatio: presetAspectRatio,
      renderQuality,
      rawEnabled,
      stylize,
      chaos,
      weird,
      seed: seed.trim(),
      personalizationCode: personalizationCode.trim(),
      negativePrompt: negativePrompt.trim()
    };

    setMjPresets((current) =>
      [
        preset,
        ...current.filter((item) => item.name !== name)
      ].slice(0, MAX_MJ_PARAMETER_PRESETS)
    );
    setSelectedMjPresetId(preset.id);
  }

  function applyMjPreset(presetId: string) {
    setSelectedMjPresetId(presetId);

    const preset = mjPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    if (preset.aspectRatio) {
      setAspectRatio(preset.aspectRatio);
    }

    setRenderQuality(preset.renderQuality);
    setRawEnabled(preset.rawEnabled);
    setStylize(preset.stylize);
    setIsStylizeDirty(true);
    setChaos(preset.chaos);
    setWeird(preset.weird);
    setSeed(preset.seed);
    setPersonalizationCode(preset.personalizationCode);
    setNegativePrompt(preset.negativePrompt);
  }

  function deleteSelectedMjPreset() {
    if (!selectedMjPresetId) {
      return;
    }

    setMjPresets((current) =>
      current.filter((item) => item.id !== selectedMjPresetId)
    );
    setSelectedMjPresetId("");
  }

  function toggleCompositionToken(
    group: MjCompositionTokenGroup,
    tokenId: string
  ) {
    markCompositionManual();
    setCompositionSelections((current) => {
      const base = isAutoCompositionActive
        ? cloneCompositionSelections(effectiveCompositionSelections)
        : current;
      const selected = base[group.key];
      const isSelected = selected.includes(tokenId);
      const nextValues =
        group.mode === "single"
          ? isSelected
            ? []
            : [tokenId]
          : isSelected
            ? selected.filter((item) => item !== tokenId)
            : [...selected, tokenId];

      return {
        ...base,
        [group.key]: nextValues
      };
    });
    setCompositionPresetId("");
  }

  function markCompositionManual() {
    setCompositionSource("manual");
  }

  function resetAutoCompositionMatch() {
    setAutoCompositionEnabled(true);
    setCompositionSource("auto");
  }

  function handleCompositionEnabledChange(checked: boolean) {
    setCompositionRecipeEnabled(checked);

    if (!checked) {
      setCompositionSource("manual");
    } else if (autoCompositionEnabled && autoCompositionPreset) {
      setCompositionSource("auto");
    }
  }

  function handleAutoCompositionEnabledChange(checked: boolean) {
    setAutoCompositionEnabled(checked);
    setCompositionSource(checked ? "auto" : "manual");
  }

  function applyCompositionPreset(presetId: string) {
    if (isAutoCompositionActive) {
      setCompositionSelections(
        cloneCompositionSelections(effectiveCompositionSelections)
      );
      setCompositionCustomText(effectiveCompositionCustomText);
      setCompositionNegativePrompt(effectiveCompositionNegativePrompt);
    }

    markCompositionManual();
    setCompositionPresetId(presetId);

    const preset = compositionPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    setCompositionRecipeEnabled(true);
    setCompositionSelections(cloneCompositionSelections(preset.selectedKeywords));
    setCompositionCustomText(preset.customText);
    setCompositionNegativePrompt(preset.negativePrompt);
  }

  function saveCurrentCompositionPreset() {
    if (!compositionPromptPreview.trim()) {
      setError({
        code: "missing_config",
        title: "缺少构图配方",
        message: "请先选择至少一个构图关键词，或填写自定义构图短句。",
        canRetry: false
      });
      return;
    }

    const fallbackName = effectiveCompositionPreset?.builtIn
      ? `${effectiveCompositionPreset.name} 副本`
      : effectiveCompositionPreset?.name || "我的构图配方";
    const name = window.prompt("构图预设名称", fallbackName)?.trim();

    if (!name) {
      return;
    }

    const previous = customCompositionPresets.find((item) => item.name === name);
    const preset: MjCompositionPreset = {
      id: previous?.id ?? createCompositionPresetId(),
      name,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      builtIn: false,
      selectedKeywords: cloneCompositionSelections(
        effectiveCompositionSelections
      ),
      customText: effectiveCompositionCustomText.trim(),
      negativePrompt: effectiveCompositionNegativePrompt.trim()
    };

    setCustomCompositionPresets((current) =>
      [
        preset,
        ...current.filter((item) => item.id !== preset.id && item.name !== name)
      ].slice(0, MAX_MJ_COMPOSITION_PRESETS)
    );
    setCompositionPresetId(preset.id);
    setCompositionRecipeEnabled(true);
    markCompositionManual();
  }

  function deleteSelectedCompositionPreset() {
    if (!selectedCustomCompositionPreset) {
      return;
    }

    setCustomCompositionPresets((current) =>
      current.filter((item) => item.id !== selectedCustomCompositionPreset.id)
    );
    setCompositionPresetId("");
    markCompositionManual();
  }

  function toggleLightingToken(
    group: MjLightingTokenGroup,
    tokenId: string
  ) {
    markLightingManual();
    setLightingSelections((current) => {
      const base = isAutoLightingActive
        ? cloneLightingSelections(effectiveLightingSelections)
        : current;
      const selected = base[group.key];
      const isSelected = selected.includes(tokenId);
      const nextValues =
        group.mode === "single"
          ? isSelected
            ? []
            : [tokenId]
          : isSelected
            ? selected.filter((item) => item !== tokenId)
            : [...selected, tokenId];

      return {
        ...base,
        [group.key]: nextValues
      };
    });
    setLightingPresetId("");
  }

  function markLightingManual() {
    setLightingSource("manual");
  }

  function resetAutoLightingMatch() {
    setAutoLightingEnabled(true);
    setLightingSource("auto");
  }

  function handleLightingEnabledChange(checked: boolean) {
    setLightingRecipeEnabled(checked);

    if (!checked) {
      setLightingSource("manual");
    } else if (autoLightingEnabled && autoLightingPreset) {
      setLightingSource("auto");
    }
  }

  function handleAutoLightingEnabledChange(checked: boolean) {
    setAutoLightingEnabled(checked);
    setLightingSource(checked ? "auto" : "manual");
  }

  function applyLightingPreset(presetId: string) {
    if (isAutoLightingActive) {
      setLightingSelections(cloneLightingSelections(effectiveLightingSelections));
      setLightingCustomText(effectiveLightingCustomText);
      setLightingNegativePrompt(effectiveLightingNegativePrompt);
    }

    markLightingManual();
    setLightingPresetId(presetId);

    const preset = lightingPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    setLightingRecipeEnabled(true);
    setLightingSelections(cloneLightingSelections(preset.selectedKeywords));
    setLightingCustomText(preset.customText);
    setLightingNegativePrompt(preset.negativePrompt);
  }

  function saveCurrentLightingPreset() {
    if (!lightingPromptPreview.trim()) {
      setError({
        code: "missing_config",
        title: "缺少光影配方",
        message: "请先选择至少一个阴影关键词，或填写自定义光影短句。",
        canRetry: false
      });
      return;
    }

    const fallbackName = effectiveLightingPreset?.builtIn
      ? `${effectiveLightingPreset.name} 副本`
      : effectiveLightingPreset?.name || "我的光影配方";
    const name = window.prompt("光影预设名称", fallbackName)?.trim();

    if (!name) {
      return;
    }

    const previous = customLightingPresets.find((item) => item.name === name);
    const preset: MjLightingPreset = {
      id: previous?.id ?? createLightingPresetId(),
      name,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      builtIn: false,
      selectedKeywords: cloneLightingSelections(effectiveLightingSelections),
      customText: effectiveLightingCustomText.trim(),
      negativePrompt: effectiveLightingNegativePrompt.trim()
    };

    setCustomLightingPresets((current) =>
      [
        preset,
        ...current.filter((item) => item.id !== preset.id && item.name !== name)
      ].slice(0, MAX_MJ_LIGHTING_PRESETS)
    );
    setLightingPresetId(preset.id);
    setLightingRecipeEnabled(true);
    markLightingManual();
  }

  function deleteSelectedLightingPreset() {
    if (!selectedCustomLightingPreset) {
      return;
    }

    setCustomLightingPresets((current) =>
      current.filter((item) => item.id !== selectedCustomLightingPreset.id)
    );
    setLightingPresetId("");
    markLightingManual();
  }

  function toggleColorToken(group: MjColorTokenGroup, tokenId: string) {
    markColorManual();
    setColorSelections((current) => {
      const base = isAutoColorActive
        ? cloneColorSelections(effectiveColorSelections)
        : current;
      const selected = base[group.key];
      const isSelected = selected.includes(tokenId);
      const nextValues =
        group.mode === "single"
          ? isSelected
            ? []
            : [tokenId]
          : isSelected
            ? selected.filter((item) => item !== tokenId)
            : [...selected, tokenId];

      return {
        ...base,
        [group.key]: nextValues
      };
    });
    setColorPresetId("");
  }

  function markColorManual() {
    setColorSource("manual");
  }

  function resetAutoColorMatch() {
    setAutoColorEnabled(true);
    setColorSource("auto");
  }

  function handleColorEnabledChange(checked: boolean) {
    setColorRecipeEnabled(checked);

    if (!checked) {
      setColorSource("manual");
    } else if (autoColorEnabled && autoColorPreset) {
      setColorSource("auto");
    }
  }

  function handleAutoColorEnabledChange(checked: boolean) {
    setAutoColorEnabled(checked);
    setColorSource(checked ? "auto" : "manual");
  }

  function applyColorPreset(presetId: string) {
    if (isAutoColorActive) {
      setColorSelections(cloneColorSelections(effectiveColorSelections));
      setColorCustomText(effectiveColorCustomText);
      setColorNegativePrompt(effectiveColorNegativePrompt);
    }

    markColorManual();
    setColorPresetId(presetId);

    const preset = colorPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    setColorRecipeEnabled(true);
    setColorSelections(cloneColorSelections(preset.selectedKeywords));
    setColorCustomText(preset.customText);
    setColorNegativePrompt(preset.negativePrompt);
  }

  function saveCurrentColorPreset() {
    if (!colorPromptPreview.trim()) {
      setError({
        code: "missing_config",
        title: "缺少配色配方",
        message: "请先选择至少一个配色关键词，或填写自定义配色短句。",
        canRetry: false
      });
      return;
    }

    const fallbackName = effectiveColorPreset?.builtIn
      ? `${effectiveColorPreset.name} 副本`
      : effectiveColorPreset?.name || "我的配色配方";
    const name = window.prompt("配色预设名称", fallbackName)?.trim();

    if (!name) {
      return;
    }

    const previous = customColorPresets.find((item) => item.name === name);
    const preset: MjColorPreset = {
      id: previous?.id ?? createColorPresetId(),
      name,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      builtIn: false,
      selectedKeywords: cloneColorSelections(effectiveColorSelections),
      customText: effectiveColorCustomText.trim(),
      negativePrompt: effectiveColorNegativePrompt.trim()
    };

    setCustomColorPresets((current) =>
      [
        preset,
        ...current.filter((item) => item.id !== preset.id && item.name !== name)
      ].slice(0, MAX_MJ_COLOR_PRESETS)
    );
    setColorPresetId(preset.id);
    setColorRecipeEnabled(true);
    markColorManual();
  }

  function deleteSelectedColorPreset() {
    if (!selectedCustomColorPreset) {
      return;
    }

    setCustomColorPresets((current) =>
      current.filter((item) => item.id !== selectedCustomColorPreset.id)
    );
    setColorPresetId("");
    markColorManual();
  }

  async function saveCurrentFavorite() {
    if (!result?.finalPrompt) {
      return;
    }

    await saveFavoriteFromItem({
      input: createAssistantInput(),
      result,
      referenceImages: createFavoriteReferenceImages(mixImages)
    });
  }

  async function saveHistoryFavorite(item: AssistantHistoryItem) {
    await saveFavoriteFromItem(item);
  }

  async function saveFavoriteFromItem(item: {
    input: AssistantPromptInput;
    result: AssistantPromptResult;
    referenceImages?: AssistantFavoriteItem["referenceImages"];
    summaryTitle?: string;
  }) {
    if (!item.result.finalPrompt?.trim()) {
      return;
    }

    const fallbackName =
      item.result.brief || item.summaryTitle || item.input.idea || "收藏提示词";
    const name = window.prompt("收藏名称", fallbackName)?.trim();

    if (!name) {
      return;
    }

    try {
      const nextFavorites = await onAddFavorite(
        name,
        item.input,
        item.result,
        item.referenceImages
      );

      setFavorites(nextFavorites);
      setLibraryTab("favorites");
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }

  async function addReferenceFiles(files: File[]) {
    if (!canAddReferenceImages) {
      return;
    }

    setIsReadingReferences(true);
    setError(null);

    try {
      const images = await createImportedImagesFromFiles(
        files,
        remainingReferenceSlots
      );

      if (images.length) {
        await onAddReferenceImages(images);
      }
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsReadingReferences(false);
    }
  }

  async function updateReferenceImages(images: CapturedImage[]) {
    try {
      setError(null);
      await onSetReferenceImages(images.slice(0, MAX_REFERENCE_IMAGE_FILES));
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }

  async function duplicateReferenceImage(index: number) {
    if (!canAddReferenceImages) {
      return;
    }

    const image = mixImages[index];

    if (!image) {
      return;
    }

    const roleKey = getReferenceRoleKey(image, index);
    const duplicate: CapturedImage = {
      ...image,
      referenceId: createReferenceId(),
      sourceTitle: image.sourceTitle ? `${image.sourceTitle} 复制` : "复制参考图"
    };
    const duplicateRoleKey = getReferenceRoleKey(duplicate, index + 1);
    const nextImages = [
      ...mixImages.slice(0, index + 1),
      duplicate,
      ...mixImages.slice(index + 1)
    ].slice(0, MAX_REFERENCE_IMAGE_FILES);

    setReferenceRoles((current) => ({
      ...current,
      [duplicateRoleKey]: current[roleKey] ?? getDefaultReferenceRole(index)
    }));

    await updateReferenceImages(nextImages);
  }

  async function removeReferenceImageAt(index: number) {
    if (disabled || isReadingReferences) {
      return;
    }

    await updateReferenceImages(
      mixImages.filter((_, imageIndex) => imageIndex !== index)
    );
  }

  async function moveReferenceImage(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || disabled || isReadingReferences) {
      return;
    }

    const nextImages = moveArrayItem(mixImages, fromIndex, toIndex);

    if (nextImages === mixImages) {
      return;
    }

    await updateReferenceImages(nextImages);
  }

  async function handleReferenceFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = collectImageFiles(event.target.files ?? []);

    if (!files.length) {
      return;
    }

    try {
      await addReferenceFiles(files);
    } finally {
      event.target.value = "";
    }
  }

  function handleReferencePaste(event: React.ClipboardEvent<HTMLElement>) {
    const files = getClipboardImageFiles(event.clipboardData);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void addReferenceFiles(files);
  }

  function handleReferenceDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsReferenceDropActive(true);
  }

  function handleReferenceDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDropActive(false);
    }
  }

  function handleReferenceDrop(event: React.DragEvent<HTMLElement>) {
    const files = getDataTransferImageFiles(event.dataTransfer);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    setIsReferenceDropActive(false);
    void addReferenceFiles(files);
  }

  function handleReferenceTileDragStart(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (disabled || isReadingReferences || mixImages.length < 2) {
      event.preventDefault();
      return;
    }

    if (isInteractiveDragTarget(event.target)) {
      event.preventDefault();
      return;
    }

    setDraggedReferenceIndex(index);
    setDragOverReferenceIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `reference-image:${index}`);
  }

  function handleReferenceTileDragOver(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (draggedReferenceIndex === null || disabled || isReadingReferences) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverReferenceIndex(index);
  }

  function handleReferenceTileDrop(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (draggedReferenceIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const fromIndex = draggedReferenceIndex;
    setDraggedReferenceIndex(null);
    setDragOverReferenceIndex(null);
    void moveReferenceImage(fromIndex, index);
  }

  function handleReferenceTileDragEnd() {
    setDraggedReferenceIndex(null);
    setDragOverReferenceIndex(null);
  }

  async function restoreAssistantItem(
    item: AssistantHistoryItem | AssistantFavoriteItem
  ) {
    const restoredImages = createCapturedImagesFromFavoriteItem(item);

    if (restoredImages.length) {
      await onSetReferenceImages(restoredImages);
    }

    setEngine(item.input.engine);
    setMode(item.input.mode);
    setIdea(item.input.idea);
    setAspectRatio(item.input.aspectRatio);
    setResolution(item.input.resolution);
    setRenderQuality(item.input.renderQuality ?? "hd");
    setRawEnabled(item.input.rawEnabled ?? true);
    setStylize(item.input.stylize ?? 120);
    setIsStylizeDirty(
      item.input.engine === "midjourney-v8.1" && typeof item.input.stylize === "number"
    );
    setChaos(item.input.chaos ?? 0);
    setWeird(item.input.weird ?? 0);
    setSeed(item.input.seed ?? "");
    setNegativePrompt(item.input.negativePrompt ?? "");
    setPersonalizationCode(item.input.personalizationCode ?? "");
    setIdentityLock(item.input.identityLock);
    setExtraSpecs(item.input.extraSpecs ?? "");
    setCompositionRecipeEnabled(
      item.input.compositionRecipeEnabled ??
        Boolean(item.input.compositionRecipe?.promptText)
    );
    setAutoCompositionEnabled(item.input.autoCompositionEnabled ?? true);
    setCompositionSource(
      item.input.compositionSource ??
        (item.input.compositionRecipe?.promptText ? "manual" : "auto")
    );
    restoreCompositionRecipe(item.input.compositionRecipe);
    setLightingRecipeEnabled(
      item.input.lightingRecipeEnabled ??
        Boolean(item.input.lightingRecipe?.promptText)
    );
    setAutoLightingEnabled(item.input.autoLightingEnabled ?? true);
    setLightingSource(
      item.input.lightingSource ??
        (item.input.lightingRecipe?.promptText ? "manual" : "auto")
    );
    restoreLightingRecipe(item.input.lightingRecipe);
    setColorRecipeEnabled(
      item.input.colorRecipeEnabled ?? Boolean(item.input.colorRecipe?.promptText)
    );
    setAutoColorEnabled(item.input.autoColorEnabled ?? true);
    setColorSource(
      item.input.colorSource ??
        (item.input.colorRecipe?.promptText ? "manual" : "auto")
    );
    restoreColorRecipe(item.input.colorRecipe);
    updateReverseContext(item.input.reverseContext);
    setResult(item.result);
    setError(null);
    setReferenceRoles((current) => {
      const next = { ...current };
      const roleImages = restoredImages.length ? restoredImages : mixImages;

      item.input.references.forEach((reference, index) => {
        const image = roleImages[index];

        if (image) {
          next[getReferenceRoleKey(image, index)] = reference.role;
        }
      });

      return next;
    });
  }

  function restoreCompositionRecipe(recipe: AssistantCompositionRecipe | undefined) {
    setCompositionPresetId(recipe?.presetId ?? "");
    setCompositionSelections(createCompositionSelectionsFromRecipe(recipe));
    setCompositionCustomText(recipe?.customText ?? "");
    setCompositionNegativePrompt(recipe?.negativePrompt ?? "");
  }

  function restoreLightingRecipe(recipe: AssistantLightingRecipe | undefined) {
    setLightingPresetId(recipe?.presetId ?? "");
    setLightingSelections(createLightingSelectionsFromRecipe(recipe));
    setLightingCustomText(recipe?.customText ?? "");
    setLightingNegativePrompt(recipe?.negativePrompt ?? "");
  }

  function restoreColorRecipe(recipe: AssistantColorRecipe | undefined) {
    setColorPresetId(recipe?.presetId ?? "");
    setColorSelections(createColorSelectionsFromRecipe(recipe));
    setColorCustomText(recipe?.customText ?? "");
    setColorNegativePrompt(recipe?.negativePrompt ?? "");
  }

  return (
    <main className="assistant-view">
      <section
        className="assistant-hero assistant-workbench-head"
        aria-label="双引擎提示词助手"
      >
        <div className="assistant-hero-title">
          <span className="hero-kicker">
            {isMidjourney ? "MIDJOURNEY V8.1 提示词" : "NANO BANANA PRO 提示词"}
          </span>
          <h2>提示词助手</h2>
        </div>
        <div className="assistant-hero-controls">
          <div
            className="assistant-engine-grid assistant-hero-segmented"
            role="tablist"
            aria-label="提示词引擎"
          >
            {ASSISTANT_ENGINES.map((item) => (
              <Tooltip content={item.hint} key={item.value}>
                <button
                  className={engine === item.value ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={engine === item.value}
                  onClick={() => setEngine(item.value)}
                >
                  {item.label}
                </button>
              </Tooltip>
            ))}
          </div>
          <div
            className="assistant-mode-grid assistant-hero-segmented"
            role="tablist"
            aria-label="任务类型"
          >
            {ASSISTANT_MODES.map((item) => (
              <Tooltip content={item.hint} key={item.value}>
                <button
                  className={mode === item.value ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.value}
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="hero-metrics">
          <Tooltip content="当前已加入多图参考队列的图片数量">
            <span>
              <ImageIcon size={14} />
              {mixImages.length ? `${mixImages.length} / 6 张参考图` : "纯文本"}
            </span>
          </Tooltip>
          <Tooltip content={`${activeQualityHint} 当前画幅为 ${displayAspectRatio}。`}>
            <span>
              {isMidjourney ? renderQuality.toUpperCase() : resolution} · {displayAspectRatio}
            </span>
          </Tooltip>
        </div>
      </section>

      <div className="assistant-grid">
        <section className="panel-section assistant-panel">
          <div className="section-header assistant-composer-head">
            <div>
              <h2>编辑</h2>
              <p>
                {currentEngine?.label ?? "Nano Banana Pro"} ·{" "}
                {currentMode?.label ?? "自动判断"} · {displayAspectRatio}
              </p>
            </div>
            <Tooltip content={currentEngine?.hint ?? "选择目标模型后生成英文提示词"}>
              <WandSparkles size={18} />
            </Tooltip>
          </div>

          <details className="assistant-guide">
            <summary>使用说明</summary>
            <div className="assistant-guide-list">
              {isMidjourney ? (
                <>
                  <span>V8.1 会输出英文完整画面句子，并把参数统一放到末尾。</span>
                  <span>本地参考图会用占位 URL，使用前需要上传到 MJ 或 Discord 替换。</span>
                  <span>V8.1 不支持 --cref、--oref、--q、--draft 或 :: 多重提示。</span>
                </>
              ) : (
                <>
                  <span>纯文字出图时，直接写画面目标、风格和要出现的文字。</span>
                  <span>多图任务先在上方“多图参考”加入图片，再给每张图指定参考角色。</span>
                  <span>需要保留人物或产品身份时，打开“身份锁定”，避免自动美化或改脸。</span>
                </>
              )}
            </div>
          </details>

          {activeReverseContext && (
            <section className="assistant-reverse-context-card">
              <div className="assistant-reverse-context-head">
                <div>
                  <strong>已带入当前反推 JSON</strong>
                  <span>
                    {activeReverseContext.templateName || "工作区反推结果"} / {activeReverseContext.sourceType}
                  </span>
                </div>
                <Tooltip content="清除反推 JSON 上下文，只保留文字想法和参考图">
                  <button
                    type="button"
                    onClick={clearReverseContext}
                    aria-label="清除反推 JSON 上下文"
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              </div>
              <div className="assistant-reverse-context-grid">
                {createReverseContextChips(activeReverseContext).map((item) => (
                  <div className="assistant-reverse-context-chip" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              <div className="assistant-reverse-context-preview">
                <strong>自然语言预览</strong>
                <p>{createReverseContextPreview(activeReverseContext)}</p>
                {activeReverseContext.negativePrompt && (
                  <span>
                    负面约束：{truncateReverseContextText(activeReverseContext.negativePrompt, 160)}
                  </span>
                )}
              </div>
              <p>
                没写想法时会默认延续这张图的风格、构图、镜头、光影和色彩；写了想法时，以新主体为主，只继承视觉语言。
              </p>
            </section>
          )}

          <label className="field-label">
            <span>想法</span>
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={6}
              placeholder={
                isMidjourney
                  ? "例如：国风武侠竹林电影画面，两名侠客在夕阳雾气中飞身交手，写实电影剧照。"
                  : "例如：生成一个国风武侠场景，角色站在雨夜古街中央，画面有电影海报质感。"
              }
            />
          </label>

          <div className="assistant-control-grid">
            <label className="field-label">
              <span>画幅比例</span>
              {isMidjourney ? (
                <div className="assistant-aspect-control">
                  <Tooltip content="MJ 支持正整数比例，例如 7:3、85:110 或 1920:1080；不支持 1.39:1 这类小数。">
                    <div className="assistant-aspect-row">
                      <select
                        value={getAspectRatioPresetValue(aspectRatio)}
                        onChange={(event) => {
                          if (event.target.value) {
                            setAspectRatio(event.target.value);
                          }
                        }}
                      >
                        <option value="">自定义比例</option>
                        {ASPECT_RATIOS.map((item) => (
                          <option value={item} key={item}>
                            {ASPECT_RATIO_LABELS[item]}
                          </option>
                        ))}
                      </select>
                      <input
                        value={aspectRatio}
                        onBlur={() => {
                          const normalized =
                            normalizeAssistantAspectRatio(aspectRatio);

                          if (normalized) {
                            setAspectRatio(normalized);
                          }
                        }}
                        onChange={(event) =>
                          setAspectRatio(
                            normalizeAssistantAspectRatioText(event.target.value)
                          )
                        }
                        aria-invalid={Boolean(aspectRatioError)}
                        placeholder="7:3"
                      />
                    </div>
                  </Tooltip>
                  {aspectRatioError && (
                    <span className="assistant-field-error">
                      {aspectRatioError}
                    </span>
                  )}
                </div>
              ) : (
                <Tooltip content="决定最终画面的宽高关系，例如海报常用 4:5 或 9:16，横版封面常用 16:9。">
                  <select
                    value={getFixedAspectRatioValue(aspectRatio)}
                    onChange={(event) =>
                      setAspectRatio(event.target.value as AssistantAspectRatio)
                    }
                  >
                    {ASPECT_RATIOS.map((item) => (
                      <option value={item} key={item}>
                        {ASPECT_RATIO_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              )}
            </label>

            {isMidjourney ? (
              <label className="field-label">
                <span>输出质量</span>
                <Tooltip content={currentRenderQuality.hint}>
                  <select
                    value={renderQuality}
                    onChange={(event) =>
                      setRenderQuality(event.target.value as AssistantRenderQuality)
                    }
                  >
                    {RENDER_QUALITIES.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
            ) : (
              <label className="field-label">
                <span>分辨率</span>
                <Tooltip content={RESOLUTION_HINTS[resolution]}>
                  <select
                    value={resolution}
                    onChange={(event) =>
                      setResolution(event.target.value as AssistantResolution)
                    }
                  >
                    {RESOLUTIONS.map((item) => (
                      <option value={item} key={item}>
                        {RESOLUTION_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
            )}
          </div>

          <Tooltip content="用于人物、角色或产品一致性任务，会要求模型不要改年龄、脸型、比例和核心识别特征。">
            <label className="identity-lock-toggle">
              <input
                type="checkbox"
                checked={identityLock}
                onChange={(event) => setIdentityLock(event.target.checked)}
              />
              <span>身份锁定</span>
            </label>
          </Tooltip>

          {isMidjourney && (
            <details className="assistant-lighting-panel" aria-label="MJ 构图与镜头配方">
              <summary className="assistant-mj-header">
                <div>
                  <strong>构图 / 镜头</strong>
                  <span>
                    {activeCompositionRecipe
                      ? activeCompositionRecipe.name ?? "自定义构图"
                      : "未启用构图配方"}
                  </span>
                </div>
                <span className="assistant-mj-summary-meta">镜头关系搭配器</span>
              </summary>

              <Tooltip content="启用后，当前构图关键词组合会写进 MJ Prompt 正文；关闭时不会影响普通 MJ 提示词生成。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={compositionRecipeEnabled}
                    onChange={(event) =>
                      handleCompositionEnabledChange(event.target.checked)
                    }
                  />
                  <span>启用构图配方</span>
                </label>
              </Tooltip>

              <Tooltip content="根据想法、规格补充和反推 JSON 自动选择最接近的内置构图预设；只作为建议，不会自动写入 Prompt。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={autoCompositionEnabled}
                    onChange={(event) =>
                      handleAutoCompositionEnabledChange(event.target.checked)
                    }
                  />
                  <span>自动匹配构图</span>
                </label>
              </Tooltip>

              <div
                className={
                  compositionSource === "manual"
                    ? "assistant-lighting-match is-manual"
                    : isAutoCompositionActive
                      ? "assistant-lighting-match is-auto"
                      : "assistant-lighting-match"
                }
              >
                <div>
                  <strong>{createRecipeMatchTitle({
                    autoEnabled: autoCompositionEnabled,
                    isAutoActive: isAutoCompositionActive,
                    source: compositionSource,
                    presetName: autoCompositionPreset?.name,
                    manualLabel: "手动构图，自动匹配暂停"
                  })}</strong>
                  <span>{createRecipeMatchDescription({
                    autoEnabled: autoCompositionEnabled,
                    isAutoActive: isAutoCompositionActive,
                    source: compositionSource,
                    match: autoCompositionMatch,
                    enabledLabel: "打开后会根据想法、规格补充和反推 JSON 选择内置构图预设。",
                    emptyLabel: "未匹配到明确构图，可手动选择预设或关键词。"
                  })}</span>
                </div>
                {compositionSource === "manual" && (
                  <button
                    type="button"
                    onClick={resetAutoCompositionMatch}
                    disabled={!autoCompositionEnabled && !autoCompositionMatch}
                  >
                    重新自动匹配
                  </button>
                )}
              </div>

              <div className="assistant-lighting-presets">
                <label className="field-label">
                  <span>构图预设</span>
                  <select
                    value={
                      isAutoCompositionActive && autoCompositionPreset
                        ? autoCompositionPreset.id
                        : compositionPresetId
                    }
                    onChange={(event) => applyCompositionPreset(event.target.value)}
                  >
                    <option value="">自定义关键词组合</option>
                    {compositionPresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>
                        {preset.builtIn ? "内置 · " : "我的 · "}
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={saveCurrentCompositionPreset}>
                  <Save size={14} />
                  <span>保存配方</span>
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedCompositionPreset}
                  disabled={!selectedCustomCompositionPreset}
                  aria-label="删除当前自定义构图预设"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="assistant-lighting-groups">
                {MJ_COMPOSITION_TOKEN_GROUPS.map((group) => (
                  <section className="assistant-lighting-group" key={group.key}>
                    <div className="assistant-lighting-group-head">
                      <strong>{group.label}</strong>
                      <span>{group.mode === "single" ? "单选" : "可多选"}</span>
                    </div>
                    <div className="assistant-lighting-chip-row">
                      {group.options.map((option) => {
                        const active = effectiveCompositionSelections[group.key].includes(
                          option.id
                        );

                        return (
                          <Tooltip content={option.text} key={option.id}>
                            <button
                              className={active ? "active" : ""}
                              type="button"
                              onClick={() => toggleCompositionToken(group, option.id)}
                              aria-pressed={active}
                            >
                              {option.label}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <label className="field-label">
                <span>自定义英文短句</span>
                <textarea
                  value={
                    isAutoCompositionActive
                      ? effectiveCompositionCustomText
                      : compositionCustomText
                  }
                  onChange={(event) => {
                    if (isAutoCompositionActive) {
                      setCompositionSelections(
                        cloneCompositionSelections(effectiveCompositionSelections)
                      );
                      setCompositionNegativePrompt(effectiveCompositionNegativePrompt);
                    }
                    markCompositionManual();
                    setCompositionCustomText(event.target.value);
                    setCompositionPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：tiny warrior silhouette used as scale reference"
                />
              </label>

              <label className="field-label">
                <span>构图负面约束</span>
                <textarea
                  value={
                    isAutoCompositionActive
                      ? effectiveCompositionNegativePrompt
                      : compositionNegativePrompt
                  }
                  onChange={(event) => {
                    if (isAutoCompositionActive) {
                      setCompositionSelections(
                        cloneCompositionSelections(effectiveCompositionSelections)
                      );
                      setCompositionCustomText(effectiveCompositionCustomText);
                    }
                    markCompositionManual();
                    setCompositionNegativePrompt(event.target.value);
                    setCompositionPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：flat composition, cluttered background, centered subject"
                />
              </label>

              <div className="assistant-lighting-preview">
                <strong>英文预览</strong>
                <span>
                  {compositionPromptPreview ||
                    "选择景别、机位、镜头、构图结构或艺术家构图逻辑后会生成英文构图片段。"}
                </span>
              </div>
            </details>
          )}

          {isMidjourney && (
            <details className="assistant-lighting-panel" aria-label="MJ 光影与阴影配方">
              <summary className="assistant-mj-header">
                <div>
                  <strong>光影 / 阴影</strong>
                  <span>
                    {activeLightingRecipe
                      ? activeLightingRecipe.name ?? "自定义光影"
                      : "未启用光影配方"}
                  </span>
                </div>
                <span className="assistant-mj-summary-meta">关键词搭配器</span>
              </summary>

              <Tooltip content="启用后，当前阴影关键词组合会写进 MJ Prompt 正文；关闭时不会影响生成。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={lightingRecipeEnabled}
                    onChange={(event) =>
                      handleLightingEnabledChange(event.target.checked)
                    }
                  />
                  <span>启用光影配方</span>
                </label>
              </Tooltip>

              <Tooltip content="根据想法、规格补充和反推 JSON 自动选择最接近的内置光影预设；手动编辑后会暂停自动覆盖。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={autoLightingEnabled}
                    onChange={(event) =>
                      handleAutoLightingEnabledChange(event.target.checked)
                    }
                  />
                  <span>自动匹配光影</span>
                </label>
              </Tooltip>

              <div
                className={
                  lightingSource === "manual"
                    ? "assistant-lighting-match is-manual"
                    : isAutoLightingActive
                      ? "assistant-lighting-match is-auto"
                      : "assistant-lighting-match"
                }
              >
                <div>
                  <strong>{createLightingMatchTitle({
                    autoLightingEnabled,
                    isAutoLightingActive,
                    lightingSource,
                    presetName: autoLightingPreset?.name
                  })}</strong>
                  <span>{createLightingMatchDescription({
                    autoLightingEnabled,
                    isAutoLightingActive,
                    lightingSource,
                    match: autoLightingMatch
                  })}</span>
                </div>
                {lightingSource === "manual" && (
                  <button
                    type="button"
                    onClick={resetAutoLightingMatch}
                    disabled={!autoLightingEnabled && !autoLightingMatch}
                  >
                    重新自动匹配
                  </button>
                )}
              </div>

              <div className="assistant-lighting-presets">
                <label className="field-label">
                  <span>场景预设</span>
                  <select
                    value={
                      isAutoLightingActive && autoLightingPreset
                        ? autoLightingPreset.id
                        : lightingPresetId
                    }
                    onChange={(event) => applyLightingPreset(event.target.value)}
                  >
                    <option value="">自定义关键词组合</option>
                    {lightingPresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>
                        {preset.builtIn ? "内置 · " : "我的 · "}
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={saveCurrentLightingPreset}>
                  <Save size={14} />
                  <span>保存配方</span>
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedLightingPreset}
                  disabled={!selectedCustomLightingPreset}
                  aria-label="删除当前自定义光影预设"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="assistant-lighting-groups">
                {MJ_LIGHTING_TOKEN_GROUPS.map((group) => (
                  <section className="assistant-lighting-group" key={group.key}>
                    <div className="assistant-lighting-group-head">
                      <strong>{group.label}</strong>
                      <span>{group.mode === "single" ? "单选" : "可多选"}</span>
                    </div>
                    <div className="assistant-lighting-chip-row">
                      {group.options.map((option) => {
                        const active = effectiveLightingSelections[group.key].includes(
                          option.id
                        );

                        return (
                          <Tooltip content={option.text} key={option.id}>
                            <button
                              className={active ? "active" : ""}
                              type="button"
                              onClick={() => toggleLightingToken(group, option.id)}
                              aria-pressed={active}
                            >
                              {option.label}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <label className="field-label">
                <span>自定义英文短句</span>
                <textarea
                  value={
                    isAutoLightingActive
                      ? effectiveLightingCustomText
                      : lightingCustomText
                  }
                  onChange={(event) => {
                    if (isAutoLightingActive) {
                      setLightingSelections(
                        cloneLightingSelections(effectiveLightingSelections)
                      );
                      setLightingNegativePrompt(effectiveLightingNegativePrompt);
                    }
                    markLightingManual();
                    setLightingCustomText(event.target.value);
                    setLightingPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：deep shadow pockets under the black tiled eaves"
                />
              </label>

              <label className="field-label">
                <span>光影负面约束</span>
                <textarea
                  value={
                    isAutoLightingActive
                      ? effectiveLightingNegativePrompt
                      : lightingNegativePrompt
                  }
                  onChange={(event) => {
                    if (isAutoLightingActive) {
                      setLightingSelections(
                        cloneLightingSelections(effectiveLightingSelections)
                      );
                      setLightingCustomText(effectiveLightingCustomText);
                    }
                    markLightingManual();
                    setLightingNegativePrompt(event.target.value);
                    setLightingPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：flat lighting, overexposed face, muddy shadows"
                />
              </label>

              <div className="assistant-lighting-preview">
                <strong>英文预览</strong>
                <span>
                  {lightingPromptPreview ||
                    "选择阴影形状、落点、边缘或补光后会生成英文光影片段。"}
                </span>
              </div>
            </details>
          )}

          {isMidjourney && (
            <details className="assistant-lighting-panel" aria-label="MJ 配色与影调配方">
              <summary className="assistant-mj-header">
                <div>
                  <strong>配色 / 影调</strong>
                  <span>
                    {activeColorRecipe
                      ? activeColorRecipe.name ?? "自定义配色"
                      : "未启用配色配方"}
                  </span>
                </div>
                <span className="assistant-mj-summary-meta">色彩关系搭配器</span>
              </summary>

              <Tooltip content="启用后，当前配色关键词组合会写进 MJ Prompt 正文；关闭时不会影响普通 MJ 提示词生成。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={colorRecipeEnabled}
                    onChange={(event) =>
                      handleColorEnabledChange(event.target.checked)
                    }
                  />
                  <span>启用配色配方</span>
                </label>
              </Tooltip>

              <Tooltip content="根据想法、规格补充和反推 JSON 自动选择最接近的内置配色预设；只作为建议，不会自动写入 Prompt。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={autoColorEnabled}
                    onChange={(event) =>
                      handleAutoColorEnabledChange(event.target.checked)
                    }
                  />
                  <span>自动匹配配色</span>
                </label>
              </Tooltip>

              <div
                className={
                  colorSource === "manual"
                    ? "assistant-lighting-match is-manual"
                    : isAutoColorActive
                      ? "assistant-lighting-match is-auto"
                      : "assistant-lighting-match"
                }
              >
                <div>
                  <strong>{createRecipeMatchTitle({
                    autoEnabled: autoColorEnabled,
                    isAutoActive: isAutoColorActive,
                    source: colorSource,
                    presetName: autoColorPreset?.name,
                    manualLabel: "手动配色，自动匹配暂停"
                  })}</strong>
                  <span>{createRecipeMatchDescription({
                    autoEnabled: autoColorEnabled,
                    isAutoActive: isAutoColorActive,
                    source: colorSource,
                    match: autoColorMatch,
                    enabledLabel: "打开后会根据想法、规格补充和反推 JSON 选择内置配色预设。",
                    emptyLabel: "未匹配到明确配色，可手动选择预设或关键词。"
                  })}</span>
                </div>
                {colorSource === "manual" && (
                  <button
                    type="button"
                    onClick={resetAutoColorMatch}
                    disabled={!autoColorEnabled && !autoColorMatch}
                  >
                    重新自动匹配
                  </button>
                )}
              </div>

              <div className="assistant-lighting-presets">
                <label className="field-label">
                  <span>配色预设</span>
                  <select
                    value={
                      isAutoColorActive && autoColorPreset
                        ? autoColorPreset.id
                        : colorPresetId
                    }
                    onChange={(event) => applyColorPreset(event.target.value)}
                  >
                    <option value="">自定义关键词组合</option>
                    {colorPresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>
                        {preset.builtIn ? "内置 · " : "我的 · "}
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={saveCurrentColorPreset}>
                  <Save size={14} />
                  <span>保存配方</span>
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedColorPreset}
                  disabled={!selectedCustomColorPreset}
                  aria-label="删除当前自定义配色预设"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="assistant-lighting-groups">
                {MJ_COLOR_TOKEN_GROUPS.map((group) => (
                  <section className="assistant-lighting-group" key={group.key}>
                    <div className="assistant-lighting-group-head">
                      <strong>{group.label}</strong>
                      <span>{group.mode === "single" ? "单选" : "可多选"}</span>
                    </div>
                    <div className="assistant-lighting-chip-row">
                      {group.options.map((option) => {
                        const active = effectiveColorSelections[group.key].includes(
                          option.id
                        );

                        return (
                          <Tooltip content={option.text} key={option.id}>
                            <button
                              className={active ? "active" : ""}
                              type="button"
                              onClick={() => toggleColorToken(group, option.id)}
                              aria-pressed={active}
                            >
                              {option.label}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <label className="field-label">
                <span>自定义英文短句</span>
                <textarea
                  value={
                    isAutoColorActive
                      ? effectiveColorCustomText
                      : colorCustomText
                  }
                  onChange={(event) => {
                    if (isAutoColorActive) {
                      setColorSelections(cloneColorSelections(effectiveColorSelections));
                      setColorNegativePrompt(effectiveColorNegativePrompt);
                    }
                    markColorManual();
                    setColorCustomText(event.target.value);
                    setColorPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：moon-white highlights on mist and wet stone"
                />
              </label>

              <label className="field-label">
                <span>配色负面约束</span>
                <textarea
                  value={
                    isAutoColorActive
                      ? effectiveColorNegativePrompt
                      : colorNegativePrompt
                  }
                  onChange={(event) => {
                    if (isAutoColorActive) {
                      setColorSelections(cloneColorSelections(effectiveColorSelections));
                      setColorCustomText(effectiveColorCustomText);
                    }
                    markColorManual();
                    setColorNegativePrompt(event.target.value);
                    setColorPresetId("");
                  }}
                  rows={2}
                  placeholder="例如：neon, overly saturated colors, plastic-looking materials"
                />
              </label>

              <div className="assistant-lighting-preview">
                <strong>英文预览</strong>
                <span>
                  {colorPromptPreview ||
                    "选择主色调、阴影色、高光色、点缀色或电影调色后会生成英文配色片段。"}
                </span>
              </div>
            </details>
          )}

          {isMidjourney && (
            <details className="assistant-mj-panel" aria-label="Midjourney V8.1 参数">
              <summary className="assistant-mj-header">
                <div>
                  <strong>MJ V8.1 参数</strong>
                  <span>
                    {renderQuality.toUpperCase()} · {rawEnabled ? "Raw" : "Default"} · S{stylize} · C{chaos} · W{weird}
                  </span>
                </div>
                <span className="assistant-mj-summary-meta">预设与高级参数</span>
              </summary>

              <div className="assistant-mj-help">
                <span><strong>Stylize</strong> 0-1000：80 偏写实控制，120 通用默认，150-250 更有风格化。</span>
                <span><strong>Chaos</strong> 0-100：0 稳定，10-25 轻探索，50+ 明显发散。</span>
                <span><strong>Weird</strong> 0-3000：常用 0-250，高值会让造型更怪异。</span>
                <span><strong>Personalization</strong> 填 --p 后面的 code；<strong>Negative Prompt</strong> 会统一写进 --no。</span>
              </div>

              <div className="assistant-mj-presets">
                <label className="field-label">
                  <span>参数预设</span>
                  <select
                    value={selectedMjPresetId}
                    onChange={(event) => applyMjPreset(event.target.value)}
                  >
                    <option value="">选择已保存预设</option>
                    {mjPresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>
                        {formatMjPresetLabel(preset)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={saveCurrentMjPreset}
                  disabled={Boolean(aspectRatioError)}
                >
                  <Save size={14} />
                  <span>保存当前预设</span>
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedMjPreset}
                  disabled={!selectedMjPresetId}
                  aria-label="删除当前 MJ 参数预设"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <Tooltip content="写实摄影、电影剧照、3A 游戏、产品和建筑默认建议启用 Raw。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={rawEnabled}
                    onChange={(event) => setRawEnabled(event.target.checked)}
                  />
                  <span>Raw 模式</span>
                </label>
              </Tooltip>

              <div className="assistant-mj-grid">
                <label className="field-label">
                  <span>Stylize</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={10}
                    value={stylize}
                    onChange={(event) => {
                      setIsStylizeDirty(true);
                      setStylize(readNumericInput(event.target.value, 120));
                    }}
                  />
                </label>
                <label className="field-label">
                  <span>Chaos</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={chaos}
                    onChange={(event) => setChaos(readNumericInput(event.target.value, 0))}
                  />
                </label>
                <label className="field-label">
                  <span>Weird</span>
                  <input
                    type="number"
                    min={0}
                    max={3000}
                    step={10}
                    value={weird}
                    onChange={(event) => setWeird(readNumericInput(event.target.value, 0))}
                  />
                </label>
                <label className="field-label">
                  <span>Seed</span>
                  <input
                    value={seed}
                    inputMode="numeric"
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="可选，如 1234"
                  />
                </label>
              </div>

              <label className="field-label">
                <span>Personalization</span>
                <input
                  value={personalizationCode}
                  onChange={(event) => setPersonalizationCode(event.target.value)}
                  placeholder="可选，填写 --p 后面的 profile code"
                />
              </label>

              <label className="field-label">
                <span>Negative Prompt</span>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  rows={2}
                  placeholder="例如：text, logo, watermark, UI, modern buildings"
                />
              </label>
            </details>
          )}

          <label className="field-label">
            <span>规格补充</span>
            <textarea
              value={extraSpecs}
              onChange={(event) => setExtraSpecs(event.target.value)}
              rows={3}
              placeholder={
                isMidjourney
                  ? "补充镜头、光影、材质、画面文字；不要写 --q、--cref、--oref、:: 等 V8.1 不支持参数。"
                  : "补充字体、品牌限制、画面文字、禁用元素、不能改变的角色特征等。"
              }
            />
          </label>

          <div className="assistant-reference-list">
            <div className="assistant-reference-header">
              <div>
                <strong>参考图</strong>
                <span>{mixImages.length} / {MAX_REFERENCE_IMAGE_FILES}</span>
              </div>
              <div className="assistant-reference-actions">
                {mixImages.length > 0 && (
                  <Tooltip content="清空当前参考图队列">
                    <button
                      type="button"
                      aria-label="清空参考图"
                      onClick={onClearReferenceImages}
                      disabled={disabled || isReadingReferences}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            <div
              className={
                isReferenceDropActive
                  ? "assistant-reference-rail is-dragging"
                  : "assistant-reference-rail"
              }
              onDragOver={handleReferenceDragOver}
              onDragLeave={handleReferenceDragLeave}
              onDrop={handleReferenceDrop}
              onPaste={handleReferencePaste}
            >
              <button
                className="assistant-reference-add-tile"
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                disabled={!canAddReferenceImages}
              >
                {isReadingReferences ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <ImagePlus size={16} />
                )}
                <span>
                  {isReadingReferences
                    ? "读取中"
                    : remainingReferenceSlots
                      ? "拖入 / 粘贴 / 点击"
                      : "已满"}
                </span>
              </button>

              {mixImages.map((image, index) => {
                const roleKey = getReferenceRoleKey(image, index);
                const role =
                  referenceRoles[roleKey] ?? getDefaultReferenceRole(index);
                const isReordering = draggedReferenceIndex === index;
                const isDropTarget =
                  draggedReferenceIndex !== null &&
                  draggedReferenceIndex !== index &&
                  dragOverReferenceIndex === index;
                const tileClassName = [
                  "assistant-reference-tile",
                  isReordering ? "is-reordering" : "",
                  isDropTarget ? "is-drop-target" : ""
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <article
                    className={tileClassName}
                    draggable={!disabled && !isReadingReferences && mixImages.length > 1}
                    key={`${roleKey}:${index}`}
                    title={`${image.sourceTitle || `参考图 ${index + 1}`}，拖拽可排序`}
                    onDragStart={(event) =>
                      handleReferenceTileDragStart(event, index)
                    }
                    onDragOver={(event) => handleReferenceTileDragOver(event, index)}
                    onDrop={(event) => handleReferenceTileDrop(event, index)}
                    onDragEnd={handleReferenceTileDragEnd}
                  >
                    <img src={image.url} alt={`参考图 ${index + 1}`} />
                    <span className="assistant-reference-index">{index + 1}</span>
                    <div className="assistant-reference-tile-actions">
                      <Tooltip content={`复制图片 ${index + 1}`}>
                        <button
                          className="assistant-reference-copy"
                          type="button"
                          aria-label={`复制图片 ${index + 1}`}
                          onClick={() => void duplicateReferenceImage(index)}
                          disabled={!canAddReferenceImages}
                        >
                          <Copy size={11} />
                        </button>
                      </Tooltip>
                      <Tooltip content={`移除图片 ${index + 1}`}>
                        <button
                          className="assistant-reference-remove"
                          type="button"
                          aria-label={`移除图片 ${index + 1}`}
                          onClick={() => void removeReferenceImageAt(index)}
                          disabled={disabled || isReadingReferences}
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tooltip>
                    </div>
                    <Tooltip content={ROLE_HINTS[role]}>
                      <label className="assistant-reference-role-pill">
                        <span className="visually-hidden">
                          图片 {index + 1} 的参考角色
                        </span>
                        <select
                          value={role}
                          aria-label={`图片 ${index + 1} 的参考角色`}
                          onChange={(event) =>
                            setReferenceRoles((current) => ({
                              ...current,
                              [roleKey]: event.target.value as AssistantReferenceRole
                            }))
                          }
                        >
                          {REFERENCE_ROLES.map((referenceRole) => (
                            <option
                              value={referenceRole.value}
                              key={referenceRole.value}
                            >
                              {referenceRole.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </Tooltip>
                  </article>
                );
              })}
            </div>

            <input
              ref={referenceInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={handleReferenceFileChange}
            />
          </div>

          {error && error.code !== "photoshop_bridge_unavailable" && (
            <section className="error-panel">
              <strong>{error.title}</strong>
              <p>{error.message}</p>
              {error.detail && <small>{error.detail}</small>}
            </section>
          )}

          <Tooltip content="生成会调用模型网关，输出最终英文提示词和中文检查项。">
            <button
              className="assistant-primary-action"
              type="button"
              onClick={generatePrompt}
              disabled={!canGenerate}
            >
              {isLoading ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
              <span>
                {isLoading
                  ? "生成中"
                  : isMidjourney
                    ? "生成 MJ Prompt"
                    : "生成提示词"}
              </span>
            </button>
          </Tooltip>
        </section>

        <section className="panel-section assistant-output">
          <div
            className={
              sentToPhotoshop
                ? "assistant-transfer-bar is-sent"
                : "assistant-transfer-bar"
            }
          >
            <div className="assistant-transfer-status">
              <span className="assistant-transfer-mark" aria-hidden="true">
                {sentToPhotoshop ? <Check size={15} /> : <Send size={15} />}
              </span>
              <div>
                <strong>发送到 Photoshop</strong>
                <span>{photoshopTransferHint}</span>
              </div>
            </div>
            <div className="assistant-transfer-controls">
              <label className="assistant-photoshop-target">
                <span>目标阶段</span>
                <Tooltip content="选择后发送给 Photoshop 插件，PS 接收并填入时会切到对应阶段；保持默认则填入 PS 当前阶段。">
                  <select
                    value={photoshopTargetStageId}
                    onChange={(event) =>
                      setPhotoshopTargetStageId(
                        event.target.value as PhotoshopTargetStageId
                      )
                    }
                  >
                    {PHOTOSHOP_TARGET_STAGES.map((stage) => (
                      <option value={stage.value} key={stage.value || "current"}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
              <Tooltip content={`发送到本机 Photoshop 场景原画助手：${photoshopTargetStage.label}`}>
                <button
                  className="assistant-send-button"
                  type="button"
                  onClick={sendToPhotoshop}
                  disabled={!result?.finalPrompt || isSendingToPhotoshop}
                >
                  {isSendingToPhotoshop ? (
                    <Loader2 className="spin" size={15} />
                  ) : sentToPhotoshop ? (
                    <Check size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                  <span>{photoshopSendLabel}</span>
                </button>
              </Tooltip>
            </div>
          </div>

          {error?.code === "photoshop_bridge_unavailable" && (
            <section className="error-panel assistant-transfer-error">
              <strong>{error.title}</strong>
              <p>{error.message}</p>
              {error.detail && <small>{error.detail}</small>}
            </section>
          )}

          <div className="section-header assistant-output-head">
            <div>
              <h2>最终英文提示词</h2>
              <p>{result?.brief || "等待生成，英文提示词和中文核对会显示在这里"}</p>
            </div>
            <div className="button-row compact">
              <Tooltip content="复制最终英文提示词">
                <button
                  type="button"
                  onClick={copyFinalPrompt}
                  disabled={!result?.finalPrompt}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </Tooltip>
              <Tooltip content="收藏当前提示词，之后可继续编辑复用">
                <button
                  type="button"
                  onClick={() => void saveCurrentFavorite()}
                  disabled={!result?.finalPrompt}
                >
                  <Star size={16} />
                </button>
              </Tooltip>
            </div>
          </div>

          {result ? (
            <>
              <div className="assistant-final-prompt">{result.finalPrompt}</div>
              <AssistantChineseCheckPanel check={result.chineseCheck} />
              <AssistantResultList title="需要确认的问题" items={result.questions} />
              <AssistantResultList title="默认假设" items={result.assumptions} />
              <AssistantResultList
                title="负面约束"
                items={result.negativeConstraints}
              />
            </>
          ) : (
            <div className="empty-state">暂无结果</div>
          )}
        </section>
      </div>

      <section className="panel-section assistant-history-panel assistant-library-panel">
        <div className="section-header assistant-library-header">
          <div>
            <h2>提示词库</h2>
            <p>
              {libraryTab === "favorites"
                ? `收藏 ${favorites.length} 条，可恢复后继续编辑`
                : `最近 ${history.length} 条，生成后自动记录`}
            </p>
          </div>
          <div className="assistant-library-toolbar">
            <div
              className="assistant-library-tabs"
              role="tablist"
              aria-label="提示词库类型"
            >
              <button
                className={libraryTab === "favorites" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={libraryTab === "favorites"}
                onClick={() => setLibraryTab("favorites")}
              >
                <Star size={14} />
                <span>收藏</span>
                <strong>{favorites.length}</strong>
              </button>
              <button
                className={libraryTab === "history" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={libraryTab === "history"}
                onClick={() => setLibraryTab("history")}
              >
                <RefreshCw size={14} />
                <span>最近</span>
                <strong>{history.length}</strong>
              </button>
            </div>
            <div className="button-row compact">
              <Tooltip
                content={
                  libraryTab === "favorites"
                    ? "刷新收藏提示词"
                    : "刷新助手历史"
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    if (libraryTab === "favorites") {
                      void refreshFavorites();
                    } else {
                      void refreshHistory();
                    }
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  libraryTab === "favorites"
                    ? "清空收藏提示词"
                    : "清空助手历史"
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    if (libraryTab === "favorites") {
                      void clearFavorites();
                    } else {
                      void clearHistory();
                    }
                  }}
                  disabled={
                    libraryTab === "favorites" ? !favorites.length : !history.length
                  }
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {libraryTab === "favorites" ? (
          favorites.length ? (
            <div className="assistant-history-list">
              {favorites.map((item) => (
                <article
                  className="assistant-history-item assistant-favorite-item"
                  key={item.id}
                >
                  <Tooltip content="恢复这条收藏并继续编辑">
                    <button
                      type="button"
                      onClick={() => void restoreAssistantItem(item)}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.summarySubtitle}</span>
                      <time>{formatDate(item.updatedAt)}</time>
                    </button>
                  </Tooltip>
                  <Tooltip content="删除这条收藏">
                    <button
                      className="icon-danger"
                      type="button"
                      onClick={() => removeFavorite(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </Tooltip>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">暂无收藏提示词</div>
          )
        ) : history.length ? (
          <div className="assistant-history-list">
            {history.map((item) => (
              <article className="assistant-history-item" key={item.id}>
                <Tooltip content="恢复这条助手记录">
                  <button
                    type="button"
                    onClick={() => void restoreAssistantItem(item)}
                  >
                    <strong>{item.summaryTitle}</strong>
                    <span>{item.summarySubtitle}</span>
                    <time>{formatDate(item.createdAt)}</time>
                  </button>
                </Tooltip>
                <Tooltip content="收藏这条助手历史">
                  <button
                    type="button"
                    onClick={() => void saveHistoryFavorite(item)}
                    disabled={!item.result.finalPrompt}
                  >
                    <Star size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="删除这条助手记录">
                  <button
                    className="icon-danger"
                    type="button"
                    onClick={() => removeHistory(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无助手历史</div>
        )}
      </section>
    </main>
  );
}

function AssistantChineseCheckPanel({
  check
}: {
  check: AssistantPromptResult["chineseCheck"];
}) {
  const hasCheck =
    Boolean(check?.backTranslation) ||
    Boolean(check?.checklist.length) ||
    Boolean(check?.possibleIssues.length);

  if (!hasCheck) {
    return (
      <details className="assistant-output-block assistant-output-detail assistant-chinese-check">
        <summary>
          <strong>中文核对</strong>
          <span>暂无</span>
        </summary>
        <p className="assistant-check-empty">旧记录暂无中文核对。</p>
      </details>
    );
  }

  return (
    <details className="assistant-output-block assistant-output-detail assistant-chinese-check">
      <summary>
        <strong>中文核对</strong>
        <span>{check?.checklist.length || 0} 项</span>
      </summary>
      {check?.backTranslation && (
        <p className="assistant-check-translation">{check.backTranslation}</p>
      )}
      <AssistantCheckList title="核对清单" items={check?.checklist ?? []} />
      <AssistantCheckList title="可能需要确认" items={check?.possibleIssues ?? []} />
    </details>
  );
}

function AssistantCheckList({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="assistant-check-group">
      <span>{title}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AssistantResultList({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) {
    return null;
  }
  const shouldCollapse = title === "默认假设" || title === "负面约束";

  if (shouldCollapse) {
    return (
      <details className="assistant-output-block assistant-output-detail">
        <summary>
          <strong>{title}</strong>
          <span>{items.length} 项</span>
        </summary>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <div className="assistant-output-block assistant-output-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function createReverseContextChips(
  context: AssistantReverseContext
): Array<{ label: string; value: string }> {
  const chips = [
    { label: "风格", value: context.fields.style },
    { label: "构图", value: context.fields.composition },
    { label: "镜头", value: context.fields.camera },
    { label: "光影", value: context.fields.lighting },
    { label: "色彩", value: context.fields.color },
    { label: "氛围", value: context.fields.mood }
  ]
    .map((item) => ({
      label: item.label,
      value: cleanReverseContextText(item.value ?? "")
    }))
    .filter((item): item is { label: string; value: string } => Boolean(item.value))
    .slice(0, 6)
    .map((item) => ({
      label: item.label,
      value: truncateReverseContextChip(item.value)
    }));

  if (chips.length) {
    return chips;
  }

  return [
    {
      label: "反推 Prompt",
      value: truncateReverseContextChip(
        cleanReverseContextText(context.promptText) ||
          createStructuredJsonSummary(context.structuredJson) ||
          "当前结果缺少可用风格信息"
      )
    }
  ];
}

function truncateReverseContextChip(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 72) {
    return normalized;
  }

  return `${normalized.slice(0, 72)}...`;
}

function createReverseContextPreview(context: AssistantReverseContext): string {
  const fields = context.fields;
  const promptText = cleanReverseContextText(context.promptText);
  const jsonSummary = createStructuredJsonSummary(context.structuredJson);
  const parts = [
    createReverseContextFieldSentence("风格延续", fields.style),
    createReverseContextFieldSentence("构图采用", fields.composition),
    createReverseContextFieldSentence("镜头语言参考", fields.camera),
    createReverseContextFieldSentence("光影保持", fields.lighting),
    createReverseContextFieldSentence("色彩倾向", fields.color),
    createReverseContextFieldSentence("整体氛围为", fields.mood)
  ].filter(Boolean);

  if (!parts.length && promptText) {
    return truncateReverseContextText(
      `将参考当前反推 Prompt：${promptText}。助手会从这段提示词中提取风格、构图、镜头、光影、色彩和氛围；如果你补充新主体、用途或题材，输出会以新主体为主，只沿用这段提示词的视觉语言。`,
      420
    );
  }

  if (!parts.length && jsonSummary) {
    return truncateReverseContextText(
      `将参考当前反推 JSON 的有效描述：${jsonSummary}。助手会把这些内容转成 MJ / Nano 可用的风格、构图、镜头和光影提示词；如果你补充新主体，会以新主体为主。`,
      420
    );
  }

  if (!parts.length) {
    return "当前反推结果还没有有效的风格、构图、镜头或光影描述。建议先完成图片分析，或切换到“风格提取 / 电影大师 / JSON提示词反推”等模板后再带入助手。";
  }

  const subjectText = cleanReverseContextText(fields.subject ?? "");
  const promptHint = promptText ? `当前反推 Prompt 可作为补充参考：${promptText}。` : "";
  const subjectHint = subjectText ? `原图主体只作为参考：${subjectText}。` : "";
  const guidance =
    "生成时会优先继承这些视觉特征；如果你在想法里写新主体、用途或题材，输出会以新主体为主。";

  return truncateReverseContextText(
    `${parts.join("；")}。${subjectHint}${promptHint}${guidance}`,
    420
  );
}

function normalizeReverseContextText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createReverseContextFieldSentence(
  prefix: string,
  value: string | undefined
): string {
  const text = cleanReverseContextText(value ?? "");
  return text ? `${prefix} ${text}` : "";
}

function cleanReverseContextText(value: string): string {
  const normalized = normalizeReverseContextText(value);

  if (!normalized) {
    return "";
  }

  const segments = normalized
    .split(/[，,；;。|\n]+/)
    .map((segment) => segment.trim())
    .filter(isMeaningfulReverseContextText);

  if (segments.length) {
    return segments.join("，");
  }

  return isMeaningfulReverseContextText(normalized) ? normalized : "";
}

function isMeaningfulReverseContextText(value: string): boolean {
  const normalized = normalizeReverseContextText(value).toLowerCase();
  const compact = normalized.replace(/\s+/g, "");

  if (!compact) {
    return false;
  }

  if (
    ["unknown", "n/a", "na", "none", "null", "undefined"].includes(compact) ||
    compact.startsWith("未识别")
  ) {
    return false;
  }

  const withoutPlaceholders = compact
    .replace(/未识别(主体|风格|光影|色调|色彩|构图|镜头|氛围|画面|内容)/g, "")
    .replace(/高质量[，,]?细节丰富/g, "")
    .replace(/[，,。；;、:：|.\-_]/g, "");

  return withoutPlaceholders.length >= 2;
}

function createStructuredJsonSummary(value: string): string {
  const normalized = normalizeReverseContextText(value);

  if (!normalized) {
    return "";
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const collected = collectMeaningfulJsonStrings(parsed);

    if (collected.length) {
      return truncateReverseContextText(collected.slice(0, 6).join("；"), 320);
    }
  } catch {
    // Fall through to text cleanup for hand-edited JSON fragments.
  }

  return truncateReverseContextText(cleanReverseContextText(normalized), 320);
}

function collectMeaningfulJsonStrings(value: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  function visit(current: unknown) {
    if (output.length >= 10) {
      return;
    }

    if (typeof current === "string") {
      const cleaned = cleanReverseContextText(current);

      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        output.push(cleaned);
      }

      return;
    }

    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!isRecord(current)) {
      return;
    }

    Object.entries(current).forEach(([key, nestedValue]) => {
      if (/^(id|url|source|metadata|version|generated_at)$/i.test(key)) {
        return;
      }

      visit(nestedValue);
    });
  }

  visit(value);
  return output;
}

function truncateReverseContextText(value: string, limit: number): string {
  const normalized = normalizeReverseContextText(value);

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function matchMjPreset(
  input: MjRecipeMatchInput,
  rules: Array<{ presetId: string; keywords: string[] }>
): MjRecipeMatch | undefined {
  const searchableText = createRecipeMatchSearchText(input);

  if (!searchableText) {
    return undefined;
  }

  const matches = rules.map((rule, ruleIndex) => {
    const matchedKeywords = rule.keywords.filter((keyword) =>
      searchableText.includes(keyword.toLowerCase())
    );

    return {
      presetId: rule.presetId,
      matchedKeywords: [...new Set(matchedKeywords)],
      score: matchedKeywords.length,
      ruleIndex
    };
  })
    .filter((match) => match.score > 0)
    .sort((left, right) =>
      right.score === left.score
        ? left.ruleIndex - right.ruleIndex
        : right.score - left.score
    );

  const best = matches[0];

  if (!best) {
    return undefined;
  }

  return {
    presetId: best.presetId,
    matchedKeywords: best.matchedKeywords,
    confidence: Math.min(0.95, 0.56 + best.score * 0.12),
    reason: `命中关键词：${best.matchedKeywords.join("、")}`
  };
}

function createRecipeMatchSearchText(input: MjRecipeMatchInput): string {
  const fields = input.reverseContext?.fields;
  return [
    input.idea,
    input.extraSpecs,
    fields?.subject,
    fields?.style,
    fields?.lighting,
    fields?.color,
    fields?.composition,
    fields?.camera,
    fields?.mood,
    input.reverseContext?.promptText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function createRecipeMatchTitle({
  autoEnabled,
  isAutoActive,
  source,
  presetName,
  manualLabel
}: {
  autoEnabled: boolean;
  isAutoActive: boolean;
  source: AssistantRecipeSource;
  presetName?: string;
  manualLabel: string;
}): string {
  if (source === "manual") {
    return manualLabel;
  }

  if (!autoEnabled) {
    return "自动匹配已关闭";
  }

  if (isAutoActive && presetName) {
    return `已自动匹配：${presetName}`;
  }

  return "未匹配到明确场景";
}

function createRecipeMatchDescription({
  autoEnabled,
  isAutoActive,
  source,
  match,
  enabledLabel,
  emptyLabel
}: {
  autoEnabled: boolean;
  isAutoActive: boolean;
  source: AssistantRecipeSource;
  match?: MjRecipeMatch;
  enabledLabel: string;
  emptyLabel: string;
}): string {
  if (source === "manual") {
    return "继续修改想法不会覆盖当前 chip 组合。";
  }

  if (!autoEnabled) {
    return enabledLabel;
  }

  if (isAutoActive && match) {
    return `${match.reason}，置信度 ${Math.round(match.confidence * 100)}%。`;
  }

  return emptyLabel;
}

function matchMjLightingPreset(
  input: MjLightingMatchInput
): MjLightingMatch | undefined {
  const searchableText = createLightingMatchSearchText(input);

  if (!searchableText) {
    return undefined;
  }

  const matches = MJ_LIGHTING_MATCH_RULES.map((rule, ruleIndex) => {
    const matchedKeywords = rule.keywords.filter((keyword) =>
      searchableText.includes(keyword.toLowerCase())
    );

    return {
      presetId: rule.presetId,
      matchedKeywords: [...new Set(matchedKeywords)],
      score: matchedKeywords.length,
      ruleIndex
    };
  })
    .filter((match) => match.score > 0)
    .sort((left, right) =>
      right.score === left.score
        ? left.ruleIndex - right.ruleIndex
        : right.score - left.score
    );

  const best = matches[0];

  if (!best) {
    return undefined;
  }

  return {
    presetId: best.presetId,
    matchedKeywords: best.matchedKeywords,
    confidence: Math.min(0.95, 0.56 + best.score * 0.12),
    reason: `命中关键词：${best.matchedKeywords.join("、")}`
  };
}

function createLightingMatchSearchText(input: MjLightingMatchInput): string {
  const fields = input.reverseContext?.fields;
  return [
    input.idea,
    input.extraSpecs,
    fields?.subject,
    fields?.style,
    fields?.lighting,
    fields?.composition,
    fields?.mood,
    input.reverseContext?.promptText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function createLightingMatchTitle({
  autoLightingEnabled,
  isAutoLightingActive,
  lightingSource,
  presetName
}: {
  autoLightingEnabled: boolean;
  isAutoLightingActive: boolean;
  lightingSource: AssistantRecipeSource;
  presetName?: string;
}): string {
  if (lightingSource === "manual") {
    return "手动光影，自动匹配暂停";
  }

  if (!autoLightingEnabled) {
    return "自动匹配已关闭";
  }

  if (isAutoLightingActive && presetName) {
    return `已自动匹配：${presetName}`;
  }

  return "未匹配到明确场景";
}

function createLightingMatchDescription({
  autoLightingEnabled,
  isAutoLightingActive,
  lightingSource,
  match
}: {
  autoLightingEnabled: boolean;
  isAutoLightingActive: boolean;
  lightingSource: AssistantRecipeSource;
  match?: MjLightingMatch;
}): string {
  if (lightingSource === "manual") {
    return "继续修改想法不会覆盖当前 chip 组合。";
  }

  if (!autoLightingEnabled) {
    return "打开后会根据想法、规格补充和反推 JSON 选择内置光影预设。";
  }

  if (isAutoLightingActive && match) {
    return `${match.reason}，置信度 ${Math.round(match.confidence * 100)}%。`;
  }

  return "未匹配到明确场景，可手动选择预设或关键词。";
}

function createBuiltInCompositionPreset(
  id: string,
  name: string,
  selectedKeywords: Partial<MjCompositionSelections>,
  customText = "",
  negativePrompt = ""
): MjCompositionPreset {
  return {
    id,
    name,
    createdAt: "builtin",
    builtIn: true,
    selectedKeywords: {
      ...createEmptyCompositionSelections(),
      ...Object.fromEntries(
        COMPOSITION_RECIPE_KEYS.map((key) => [
          key,
          selectedKeywords[key]?.filter((item) =>
            hasCompositionToken(key, item)
          ) ?? []
        ])
      ) as MjCompositionSelections
    },
    customText,
    negativePrompt
  };
}

function createEmptyCompositionSelections(): MjCompositionSelections {
  return {
    shotSize: [],
    cameraAngle: [],
    lens: [],
    structure: [],
    focalHierarchy: [],
    artistLogic: []
  };
}

function cloneCompositionSelections(
  selections: Partial<MjCompositionSelections> | undefined
): MjCompositionSelections {
  const next = createEmptyCompositionSelections();

  COMPOSITION_RECIPE_KEYS.forEach((key) => {
    next[key] = (selections?.[key] ?? []).filter((item) =>
      hasCompositionToken(key, item)
    );
  });

  return next;
}

function createCompositionSelectionsFromRecipe(
  recipe: AssistantCompositionRecipe | undefined
): MjCompositionSelections {
  return readStoredCompositionSelections(recipe?.selectedKeywords);
}

function createCompositionRecipeKeywords(
  selections: MjCompositionSelections
): AssistantCompositionRecipe["selectedKeywords"] {
  const entries = COMPOSITION_RECIPE_KEYS.map((key) => {
    const values = selections[key];

    return values.length ? [key, values] : undefined;
  }).filter((entry): entry is [AssistantCompositionRecipeKey, string[]] =>
    Boolean(entry)
  );

  return entries.length
    ? Object.fromEntries(entries) as AssistantCompositionRecipe["selectedKeywords"]
    : undefined;
}

function buildMjCompositionPrompt(
  selections: MjCompositionSelections,
  customText: string
): string {
  const shotSize = getCompositionTokenText("shotSize", selections.shotSize[0]);
  const cameraAngle = getCompositionTokenText(
    "cameraAngle",
    selections.cameraAngle[0]
  );
  const lens = getCompositionTokenText("lens", selections.lens[0]);
  const structures = selections.structure
    .map((id) => getCompositionTokenText("structure", id))
    .filter(Boolean);
  const focalHierarchy = selections.focalHierarchy
    .map((id) => getCompositionTokenText("focalHierarchy", id))
    .filter(Boolean);
  const artistLogic = selections.artistLogic
    .map((id) => getCompositionTokenText("artistLogic", id))
    .filter(Boolean);
  const customClauses = customText
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    shotSize,
    cameraAngle,
    lens,
    ...structures,
    ...focalHierarchy,
    ...artistLogic,
    ...customClauses
  ]
    .filter(Boolean)
    .join(", ");
}

function readStoredCompositionSelections(value: unknown): MjCompositionSelections {
  if (!isRecord(value)) {
    return createEmptyCompositionSelections();
  }

  const selections = createEmptyCompositionSelections();

  COMPOSITION_RECIPE_KEYS.forEach((key) => {
    selections[key] = readStringArray(value[key]).filter((item) =>
      hasCompositionToken(key, item)
    );
  });

  return selections;
}

function readStoredCompositionKeywords(
  value: unknown
): AssistantCompositionRecipe["selectedKeywords"] {
  const selections = readStoredCompositionSelections(value);
  return createCompositionRecipeKeywords(selections);
}

function getCompositionTokenText(
  key: AssistantCompositionRecipeKey,
  tokenId: string | undefined
): string {
  if (!tokenId) {
    return "";
  }

  return getCompositionToken(key, tokenId)?.text ?? "";
}

function hasCompositionToken(
  key: AssistantCompositionRecipeKey,
  tokenId: string
): boolean {
  return Boolean(getCompositionToken(key, tokenId));
}

function getCompositionToken(
  key: AssistantCompositionRecipeKey,
  tokenId: string
): MjRecipeToken | undefined {
  return MJ_COMPOSITION_TOKEN_GROUPS.find(
    (group) => group.key === key
  )?.options.find((option) => option.id === tokenId);
}

function createBuiltInLightingPreset(
  id: string,
  name: string,
  selectedKeywords: Partial<MjLightingSelections>,
  customText = "",
  negativePrompt = ""
): MjLightingPreset {
  return {
    id,
    name,
    createdAt: "builtin",
    builtIn: true,
    selectedKeywords: {
      ...createEmptyLightingSelections(),
      ...Object.fromEntries(
        LIGHTING_RECIPE_KEYS.map((key) => [
          key,
          selectedKeywords[key]?.filter((item) =>
            hasLightingToken(key, item)
          ) ?? []
        ])
      ) as MjLightingSelections
    },
    customText,
    negativePrompt
  };
}

function createEmptyLightingSelections(): MjLightingSelections {
  return {
    shadowShapes: [],
    shadowTargets: [],
    shadowEdges: [],
    contrast: [],
    shadowSources: [],
    fillLights: []
  };
}

function cloneLightingSelections(
  selections: Partial<MjLightingSelections> | undefined
): MjLightingSelections {
  const next = createEmptyLightingSelections();

  LIGHTING_RECIPE_KEYS.forEach((key) => {
    next[key] = (selections?.[key] ?? []).filter((item) =>
      hasLightingToken(key, item)
    );
  });

  return next;
}

function createLightingSelectionsFromRecipe(
  recipe: AssistantLightingRecipe | undefined
): MjLightingSelections {
  return readStoredLightingSelections(recipe?.selectedKeywords);
}

function createLightingRecipeKeywords(
  selections: MjLightingSelections
): AssistantLightingRecipe["selectedKeywords"] {
  const entries = LIGHTING_RECIPE_KEYS.map((key) => {
    const values = selections[key];

    return values.length ? [key, values] : undefined;
  }).filter((entry): entry is [AssistantLightingRecipeKey, string[]] =>
    Boolean(entry)
  );

  return entries.length
    ? Object.fromEntries(entries) as AssistantLightingRecipe["selectedKeywords"]
    : undefined;
}

function buildMjLightingPrompt(
  selections: MjLightingSelections,
  customText: string
): string {
  const edge = getLightingTokenText("shadowEdges", selections.shadowEdges[0]);
  const shapes = selections.shadowShapes
    .map((id) => getLightingTokenText("shadowShapes", id))
    .filter(Boolean);
  const targets = selections.shadowTargets
    .map((id) => getLightingTokenText("shadowTargets", id))
    .filter(Boolean);
  const sources = selections.shadowSources
    .map((id) => getLightingTokenText("shadowSources", id))
    .filter(Boolean);
  const contrast = selections.contrast
    .map((id) => getLightingTokenText("contrast", id))
    .filter(Boolean);
  const fillLights = selections.fillLights
    .map((id) => getLightingTokenText("fillLights", id))
    .filter(Boolean);
  const clauses = shapes.map((shape, index) => {
    const source = sources[index % Math.max(sources.length, 1)];
    const target = targets[index % Math.max(targets.length, 1)];

    return [
      edge,
      shape,
      source,
      target
    ]
      .filter(Boolean)
      .join(" ");
  });
  const customClauses = customText
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    ...clauses,
    ...contrast,
    ...fillLights,
    ...customClauses
  ].join(", ");
}

function readStoredLightingSelections(value: unknown): MjLightingSelections {
  if (!isRecord(value)) {
    return createEmptyLightingSelections();
  }

  const selections = createEmptyLightingSelections();

  LIGHTING_RECIPE_KEYS.forEach((key) => {
    selections[key] = readStringArray(value[key]).filter((item) =>
      hasLightingToken(key, item)
    );
  });

  return selections;
}

function readStoredLightingKeywords(
  value: unknown
): AssistantLightingRecipe["selectedKeywords"] {
  const selections = readStoredLightingSelections(value);
  return createLightingRecipeKeywords(selections);
}

function getLightingTokenText(
  key: AssistantLightingRecipeKey,
  tokenId: string | undefined
): string {
  if (!tokenId) {
    return "";
  }

  return getLightingToken(key, tokenId)?.text ?? "";
}

function hasLightingToken(
  key: AssistantLightingRecipeKey,
  tokenId: string
): boolean {
  return Boolean(getLightingToken(key, tokenId));
}

function getLightingToken(
  key: AssistantLightingRecipeKey,
  tokenId: string
): MjRecipeToken | undefined {
  return MJ_LIGHTING_TOKEN_GROUPS.find((group) => group.key === key)?.options.find(
    (option) => option.id === tokenId
  );
}

function createLightingPresetId(): string {
  return `mj-lighting-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createBuiltInColorPreset(
  id: string,
  name: string,
  selectedKeywords: Partial<MjColorSelections>,
  customText = "",
  negativePrompt = ""
): MjColorPreset {
  return {
    id,
    name,
    createdAt: "builtin",
    builtIn: true,
    selectedKeywords: {
      ...createEmptyColorSelections(),
      ...Object.fromEntries(
        COLOR_RECIPE_KEYS.map((key) => [
          key,
          selectedKeywords[key]?.filter((item) =>
            hasColorToken(key, item)
          ) ?? []
        ])
      ) as MjColorSelections
    },
    customText,
    negativePrompt
  };
}

function createEmptyColorSelections(): MjColorSelections {
  return {
    dominantPalette: [],
    shadowColor: [],
    highlightColor: [],
    accentColor: [],
    saturationContrast: [],
    grading: []
  };
}

function cloneColorSelections(
  selections: Partial<MjColorSelections> | undefined
): MjColorSelections {
  const next = createEmptyColorSelections();

  COLOR_RECIPE_KEYS.forEach((key) => {
    next[key] = (selections?.[key] ?? []).filter((item) =>
      hasColorToken(key, item)
    );
  });

  return next;
}

function createColorSelectionsFromRecipe(
  recipe: AssistantColorRecipe | undefined
): MjColorSelections {
  return readStoredColorSelections(recipe?.selectedKeywords);
}

function createColorRecipeKeywords(
  selections: MjColorSelections
): AssistantColorRecipe["selectedKeywords"] {
  const entries = COLOR_RECIPE_KEYS.map((key) => {
    const values = selections[key];

    return values.length ? [key, values] : undefined;
  }).filter((entry): entry is [AssistantColorRecipeKey, string[]] =>
    Boolean(entry)
  );

  return entries.length
    ? Object.fromEntries(entries) as AssistantColorRecipe["selectedKeywords"]
    : undefined;
}

function buildMjColorPrompt(
  selections: MjColorSelections,
  customText: string
): string {
  const dominantPalette = getColorTokenText(
    "dominantPalette",
    selections.dominantPalette[0]
  );
  const shadowColor = getColorTokenText("shadowColor", selections.shadowColor[0]);
  const highlightColor = getColorTokenText(
    "highlightColor",
    selections.highlightColor[0]
  );
  const accentColor = selections.accentColor
    .map((id) => getColorTokenText("accentColor", id))
    .filter(Boolean);
  const saturationContrast = selections.saturationContrast
    .map((id) => getColorTokenText("saturationContrast", id))
    .filter(Boolean);
  const grading = selections.grading
    .map((id) => getColorTokenText("grading", id))
    .filter(Boolean);
  const customClauses = customText
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    dominantPalette,
    shadowColor,
    highlightColor,
    ...accentColor,
    ...saturationContrast,
    ...grading,
    ...customClauses
  ]
    .filter(Boolean)
    .join(", ");
}

function readStoredColorSelections(value: unknown): MjColorSelections {
  if (!isRecord(value)) {
    return createEmptyColorSelections();
  }

  const selections = createEmptyColorSelections();

  COLOR_RECIPE_KEYS.forEach((key) => {
    selections[key] = readStringArray(value[key]).filter((item) =>
      hasColorToken(key, item)
    );
  });

  return selections;
}

function readStoredColorKeywords(
  value: unknown
): AssistantColorRecipe["selectedKeywords"] {
  const selections = readStoredColorSelections(value);
  return createColorRecipeKeywords(selections);
}

function getColorTokenText(
  key: AssistantColorRecipeKey,
  tokenId: string | undefined
): string {
  if (!tokenId) {
    return "";
  }

  return getColorToken(key, tokenId)?.text ?? "";
}

function hasColorToken(
  key: AssistantColorRecipeKey,
  tokenId: string
): boolean {
  return Boolean(getColorToken(key, tokenId));
}

function getColorToken(
  key: AssistantColorRecipeKey,
  tokenId: string
): MjRecipeToken | undefined {
  return MJ_COLOR_TOKEN_GROUPS.find((group) => group.key === key)?.options.find(
    (option) => option.id === tokenId
  );
}

function createCompositionPresetId(): string {
  return `mj-composition-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createColorPresetId(): string {
  return `mj-color-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createPresetId(): string {
  return `mj-preset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function formatMjPresetLabel(preset: MjParameterPreset): string {
  return preset.aspectRatio ? `${preset.name} · ${preset.aspectRatio}` : preset.name;
}

function createFavoriteReferenceImages(
  images: CapturedImage[]
): NonNullable<AssistantFavoriteItem["referenceImages"]> {
  return images.slice(0, MAX_REFERENCE_IMAGE_FILES).map((image, index) => ({
    id: image.referenceId ?? `favorite-ref-${index + 1}`,
    url: image.url,
    sourceImageUrl: image.url,
    sourcePageUrl: image.sourcePageUrl,
    sourceTitle: image.sourceTitle,
    thumbnail: image.url
  }));
}

function createCapturedImagesFromFavoriteItem(
  item: AssistantHistoryItem | AssistantFavoriteItem
): CapturedImage[] {
  const fromReferenceImages = (item.referenceImages ?? [])
    .map((reference): CapturedImage | undefined => {
      const url = reference.url ?? reference.thumbnail ?? reference.sourceImageUrl;

      return url
        ? {
            url,
            sourcePageUrl: reference.sourcePageUrl,
            sourceTitle: reference.sourceTitle,
            referenceId: reference.id
          }
        : undefined;
    })
    .filter((image): image is CapturedImage => Boolean(image));

  if (fromReferenceImages.length) {
    return fromReferenceImages;
  }

  return item.input.references
    .map((reference, index): CapturedImage | undefined => {
      const url = reference.imageUrl ?? reference.sourceImageUrl;

      return url
        ? {
            url,
            sourcePageUrl: reference.sourcePageUrl,
            sourceTitle: reference.sourceTitle,
            referenceId: `assistant-ref-${index + 1}`
          }
        : undefined;
    })
    .filter((image): image is CapturedImage => Boolean(image));
}

function readAssistantDraftState(): AssistantDraftState | undefined {
  const record = readStorageRecord(ASSISTANT_DRAFT_STORAGE_KEY);

  if (!record) {
    return undefined;
  }

  return {
    engine: readAssistantEngineValue(record.engine),
    mode: readAssistantModeValue(record.mode),
    idea: readStringValue(record.idea),
    aspectRatio: readAspectRatioValue(record.aspectRatio),
    resolution: readResolutionValue(record.resolution),
    renderQuality: readRenderQualityValue(record.renderQuality),
    rawEnabled: readBooleanValue(record.rawEnabled, true),
    stylize: readNumberValue(record.stylize, 120),
    isStylizeDirty: readBooleanValue(record.isStylizeDirty, false),
    chaos: readNumberValue(record.chaos, 0),
    weird: readNumberValue(record.weird, 0),
    seed: readStringValue(record.seed),
    negativePrompt: readStringValue(record.negativePrompt),
    personalizationCode: readStringValue(record.personalizationCode),
    identityLock: readBooleanValue(record.identityLock, false),
    photoshopTargetStageId: readPhotoshopStageValue(record.photoshopTargetStageId),
    extraSpecs: readStringValue(record.extraSpecs),
    compositionRecipeEnabled: readBooleanValue(
      record.compositionRecipeEnabled,
      false
    ),
    autoCompositionEnabled: readBooleanValue(record.autoCompositionEnabled, true),
    compositionSource: readRecipeSourceValue(
      record.compositionSource,
      record.compositionRecipe ? "manual" : "auto"
    ),
    compositionRecipe: readStoredCompositionRecipe(record.compositionRecipe),
    lightingRecipeEnabled: readBooleanValue(
      record.lightingRecipeEnabled,
      Boolean(record.lightingRecipe)
    ),
    autoLightingEnabled: readBooleanValue(record.autoLightingEnabled, true),
    lightingSource: readRecipeSourceValue(
      record.lightingSource,
      record.lightingRecipe ? "manual" : "auto"
    ),
    lightingRecipe: readStoredLightingRecipe(record.lightingRecipe),
    colorRecipeEnabled: readBooleanValue(record.colorRecipeEnabled, false),
    autoColorEnabled: readBooleanValue(record.autoColorEnabled, true),
    colorSource: readRecipeSourceValue(
      record.colorSource,
      record.colorRecipe ? "manual" : "auto"
    ),
    colorRecipe: readStoredColorRecipe(record.colorRecipe),
    reverseContext: readStoredReverseContext(record.reverseContext),
    result: readStoredAssistantResult(record.result)
  };
}

function writeAssistantDraftState(draft: AssistantDraftState) {
  writeStorageRecord(ASSISTANT_DRAFT_STORAGE_KEY, draft);
}

function readMjParameterPresets(): MjParameterPreset[] {
  const value = readStorageValue(MJ_PARAMETER_PRESETS_STORAGE_KEY);

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStoredMjPreset)
    .filter((preset): preset is MjParameterPreset => Boolean(preset))
    .slice(0, MAX_MJ_PARAMETER_PRESETS);
}

function writeMjParameterPresets(presets: MjParameterPreset[]) {
  writeStorageRecord(
    MJ_PARAMETER_PRESETS_STORAGE_KEY,
    presets.slice(0, MAX_MJ_PARAMETER_PRESETS)
  );
}

function readMjCompositionPresets(): MjCompositionPreset[] {
  const value = readStorageValue(MJ_COMPOSITION_PRESETS_STORAGE_KEY);

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStoredMjCompositionPreset)
    .filter((preset): preset is MjCompositionPreset => Boolean(preset))
    .slice(0, MAX_MJ_COMPOSITION_PRESETS);
}

function writeMjCompositionPresets(presets: MjCompositionPreset[]) {
  writeStorageRecord(
    MJ_COMPOSITION_PRESETS_STORAGE_KEY,
    presets
      .filter((preset) => !preset.builtIn)
      .slice(0, MAX_MJ_COMPOSITION_PRESETS)
  );
}

function readMjLightingPresets(): MjLightingPreset[] {
  const value = readStorageValue(MJ_LIGHTING_PRESETS_STORAGE_KEY);

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStoredMjLightingPreset)
    .filter((preset): preset is MjLightingPreset => Boolean(preset))
    .slice(0, MAX_MJ_LIGHTING_PRESETS);
}

function writeMjLightingPresets(presets: MjLightingPreset[]) {
  writeStorageRecord(
    MJ_LIGHTING_PRESETS_STORAGE_KEY,
    presets
      .filter((preset) => !preset.builtIn)
      .slice(0, MAX_MJ_LIGHTING_PRESETS)
  );
}

function readMjColorPresets(): MjColorPreset[] {
  const value = readStorageValue(MJ_COLOR_PRESETS_STORAGE_KEY);

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStoredMjColorPreset)
    .filter((preset): preset is MjColorPreset => Boolean(preset))
    .slice(0, MAX_MJ_COLOR_PRESETS);
}

function writeMjColorPresets(presets: MjColorPreset[]) {
  writeStorageRecord(
    MJ_COLOR_PRESETS_STORAGE_KEY,
    presets
      .filter((preset) => !preset.builtIn)
      .slice(0, MAX_MJ_COLOR_PRESETS)
  );
}

function readStoredMjPreset(value: unknown): MjParameterPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readStringValue(value.name).trim();

  if (!name) {
    return undefined;
  }

  return {
    id: readStringValue(value.id) || createPresetId(),
    name,
    createdAt: readStringValue(value.createdAt) || new Date().toISOString(),
    aspectRatio: normalizeAssistantAspectRatio(value.aspectRatio),
    renderQuality: readRenderQualityValue(value.renderQuality),
    rawEnabled: readBooleanValue(value.rawEnabled, true),
    stylize: readNumberValue(value.stylize, 120),
    chaos: readNumberValue(value.chaos, 0),
    weird: readNumberValue(value.weird, 0),
    seed: readStringValue(value.seed),
    personalizationCode: readStringValue(value.personalizationCode),
    negativePrompt: readStringValue(value.negativePrompt)
  };
}

function readStoredMjCompositionPreset(
  value: unknown
): MjCompositionPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readStringValue(value.name).trim();

  if (!name) {
    return undefined;
  }

  return {
    id: readStringValue(value.id) || createCompositionPresetId(),
    name,
    createdAt: readStringValue(value.createdAt) || new Date().toISOString(),
    builtIn: false,
    selectedKeywords: readStoredCompositionSelections(value.selectedKeywords),
    customText: readStringValue(value.customText),
    negativePrompt: readStringValue(value.negativePrompt)
  };
}

function readStoredMjLightingPreset(value: unknown): MjLightingPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readStringValue(value.name).trim();

  if (!name) {
    return undefined;
  }

  return {
    id: readStringValue(value.id) || createLightingPresetId(),
    name,
    createdAt: readStringValue(value.createdAt) || new Date().toISOString(),
    builtIn: false,
    selectedKeywords: readStoredLightingSelections(value.selectedKeywords),
    customText: readStringValue(value.customText),
    negativePrompt: readStringValue(value.negativePrompt)
  };
}

function readStoredMjColorPreset(value: unknown): MjColorPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readStringValue(value.name).trim();

  if (!name) {
    return undefined;
  }

  return {
    id: readStringValue(value.id) || createColorPresetId(),
    name,
    createdAt: readStringValue(value.createdAt) || new Date().toISOString(),
    builtIn: false,
    selectedKeywords: readStoredColorSelections(value.selectedKeywords),
    customText: readStringValue(value.customText),
    negativePrompt: readStringValue(value.negativePrompt)
  };
}

function readStoredCompositionRecipe(
  value: unknown
): AssistantCompositionRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readStringValue(value.promptText).trim();

  if (!promptText) {
    return undefined;
  }

  return {
    name: readStringValue(value.name) || "自定义构图",
    promptText,
    negativePrompt: readStringValue(value.negativePrompt) || undefined,
    presetId: readStringValue(value.presetId) || undefined,
    customText: readStringValue(value.customText) || undefined,
    selectedKeywords: readStoredCompositionKeywords(value.selectedKeywords)
  };
}

function readStoredLightingRecipe(
  value: unknown
): AssistantLightingRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readStringValue(value.promptText).trim();

  if (!promptText) {
    return undefined;
  }

  return {
    name: readStringValue(value.name) || "自定义光影",
    promptText,
    negativePrompt: readStringValue(value.negativePrompt) || undefined,
    presetId: readStringValue(value.presetId) || undefined,
    customText: readStringValue(value.customText) || undefined,
    selectedKeywords: readStoredLightingKeywords(value.selectedKeywords)
  };
}

function readStoredColorRecipe(
  value: unknown
): AssistantColorRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readStringValue(value.promptText).trim();

  if (!promptText) {
    return undefined;
  }

  return {
    name: readStringValue(value.name) || "自定义配色",
    promptText,
    negativePrompt: readStringValue(value.negativePrompt) || undefined,
    presetId: readStringValue(value.presetId) || undefined,
    customText: readStringValue(value.customText) || undefined,
    selectedKeywords: readStoredColorKeywords(value.selectedKeywords)
  };
}

function readStoredAssistantResult(
  value: unknown
): AssistantPromptResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const brief = readStringValue(value.brief);
  const finalPrompt = readStringValue(value.finalPrompt);

  if (!brief && !finalPrompt) {
    return null;
  }

  const chineseCheck = readStoredChineseCheck(value.chineseCheck);

  return {
    brief,
    finalPrompt,
    questions: readStringArray(value.questions),
    assumptions: readStringArray(value.assumptions),
    negativeConstraints: readStringArray(value.negativeConstraints),
    ...(chineseCheck ? { chineseCheck } : {})
  };
}

function readStoredChineseCheck(
  value: unknown
): AssistantPromptResult["chineseCheck"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    backTranslation: readStringValue(value.backTranslation),
    checklist: readStringArray(value.checklist),
    possibleIssues: readStringArray(value.possibleIssues)
  };
}

function readStoredReverseContext(
  value: unknown
): AssistantReverseContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readStringValue(value.promptText);
  const structuredJson = readStringValue(value.structuredJson);

  if (!promptText && !structuredJson) {
    return undefined;
  }

  return {
    sourceType: (readStringValue(value.sourceType) || "single") as AssistantReverseContext["sourceType"],
    templateName: readStringValue(value.templateName) || undefined,
    promptText,
    negativePrompt: readStringValue(value.negativePrompt) || undefined,
    structuredJson,
    fields: readStoredReverseFields(value.fields)
  };
}

function readStoredReverseFields(
  value: unknown
): AssistantReverseContext["fields"] {
  if (!isRecord(value)) {
    return {};
  }

  const fields: AssistantReverseContext["fields"] = {};
  const keys: Array<keyof AssistantReverseContext["fields"]> = [
    "subject",
    "style",
    "lighting",
    "color",
    "composition",
    "camera",
    "mood",
    "quality"
  ];

  keys.forEach((key) => {
    const fieldValue = cleanReverseContextText(readStringValue(value[key]));

    if (fieldValue) {
      fields[key] = fieldValue;
    }
  });

  return fields;
}

function readStorageRecord(key: string): Record<string, unknown> | undefined {
  const value = readStorageValue(key);
  return isRecord(value) ? value : undefined;
}

function readStorageValue(key: string): unknown {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : undefined;
  } catch {
    return undefined;
  }
}

function writeStorageRecord(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable or full inside extension contexts.
  }
}

function readStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readAssistantEngineValue(value: unknown): AssistantEngine {
  return value === "midjourney-v8.1" ? "midjourney-v8.1" : "nano-banana-pro";
}

function readAssistantModeValue(value: unknown): AssistantPromptMode {
  return isOneOf(value, ["auto", "text-to-image", "image-and-text", "editing"] as const)
    ? value
    : "auto";
}

function getAspectRatioPresetValue(
  value: AssistantAspectRatio
): AssistantAspectRatioPreset | "" {
  return isOneOf(value, ASPECT_RATIOS) ? value : "";
}

function getFixedAspectRatioValue(
  value: AssistantAspectRatio
): AssistantAspectRatioPreset {
  return getAspectRatioPresetValue(value) || "16:9";
}

function getAssistantAspectRatioForEngine(
  engine: AssistantEngine,
  value: AssistantAspectRatio
): AssistantAspectRatio {
  if (engine === "midjourney-v8.1") {
    return normalizeAssistantAspectRatio(value) ?? "16:9";
  }

  return getFixedAspectRatioValue(value);
}

function readAspectRatioValue(value: unknown): AssistantAspectRatio {
  return normalizeAssistantAspectRatio(value) ?? "16:9";
}

function readResolutionValue(value: unknown): AssistantResolution {
  return isOneOf(value, RESOLUTIONS) ? value : "2K";
}

function readRenderQualityValue(value: unknown): AssistantRenderQuality {
  return value === "sd" ? "sd" : "hd";
}

function readRecipeSourceValue(
  value: unknown,
  fallback: AssistantRecipeSource = "auto"
): AssistantRecipeSource {
  return isOneOf(value, ["auto", "manual"] as const) ? value : fallback;
}

function readPhotoshopStageValue(value: unknown): PhotoshopTargetStageId {
  return PHOTOSHOP_TARGET_STAGES.some((stage) => stage.value === value)
    ? (value as PhotoshopTargetStageId)
    : "";
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDefaultReferenceRole(index: number): AssistantReferenceRole {
  return index === 0 ? "identity" : "style";
}

function getReferenceRoleKey(image: CapturedImage, index: number): string {
  return image.referenceId ?? image.url ?? `reference-${index}`;
}

function createReferenceId(): string {
  return `reference-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);

  if (!item) {
    return items;
  }

  next.splice(toIndex, 0, item);
  return next;
}

function isInteractiveDragTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, input, label, select, textarea"))
  );
}

function readNumericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMidjourneyStylizePreset(
  aspectRatio: AssistantAspectRatio,
  renderQuality: AssistantRenderQuality
): number {
  const normalizedAspectRatio = normalizeAssistantAspectRatio(aspectRatio) ?? "16:9";

  if (renderQuality === "sd") {
    return 150;
  }

  if (normalizedAspectRatio === "4:5") {
    return 80;
  }

  if (
    normalizedAspectRatio === "21:9" ||
    normalizedAspectRatio === "3:4" ||
    normalizedAspectRatio === "2:3"
  ) {
    return 150;
  }

  return 120;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
