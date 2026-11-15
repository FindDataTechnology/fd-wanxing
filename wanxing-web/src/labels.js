// 标签人读字典（unify-wanxing-surface-language D6）
//
// 标签源头是 pack manifest（paas 侧），萬星只透传——本模块不改源数据，只在**渲染时**翻译，
// 因为它是「怎么对访客说」而不是「数据是什么」。生产侧改它会污染 registry 契约。
//
// 未命中一律原样返回（fail-open 到原文）：一个新标签不该因为字典没跟上就从页面上消失。

export const LABEL_DICT = {
  // 五条产品线的线标记
  wire: "柏讯",
  lex: "识律",
  facet: "谦面",
  yizuo: "壹座",
  wanxing: "萬星",
  constellation: "萬星",
  finddata: "寻数",
  // 内部治理标记
  "security-pending": "待安全复核",
  M2: "里程碑 2",
  // 已在生产目录里出现的英文标签
  copilot: "副驾",
  cluster: "集群",
  market: "市场",
  briefing: "简报",
  planner: "计划",
  Office: "办公文档",
  // 目录分类（facets 的 category）
  company: "寻数",
  research: "研究",
  daas: "DaaS",
  "doc-studio": "文档工坊",
  docs: "文档",
};

/** 标签 -> 人读文案。未命中原样返回。 */
export function label(tag) {
  if (tag == null) return "";
  return LABEL_DICT[tag] ?? String(tag);
}

/** 该标签是否被字典翻译过（用于决定要不要把原值挂到 title）。 */
export function isTranslated(tag) {
  return tag != null && Object.prototype.hasOwnProperty.call(LABEL_DICT, tag);
}
