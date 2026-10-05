// 文本方章：站点记号一律用汉字文本渲染，不引入任何图片资源。
// 放置规则（wanxing-web spec「The site header carries the single-character
// site mark」）：导航栏用单字（萬），页脚品牌区与阶梯行用双字（萬星）。
// 印章红与宋体栈与识律 SealMark、谦面 SiteMark 同款，家族记号成套。
const SEAL_RED = "#A6402F";
const SEAL_SERIF = "'Noto Serif SC', 'Songti SC', 'SimSun', serif";

const SIZE = {
  sm: "h-7 w-7 text-[10px]", // 阶梯行
  md: "h-8 w-8 text-[12px]", // 导航栏
  lg: "h-11 w-11 text-[14px]", // 页脚品牌区
};

export function SiteMark({ chars, size = "md", variant = "seal", className = "" }) {
  const two = Array.from(chars).length > 1;
  const tone =
    variant === "seal"
      ? "text-white"
      : "border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300";
  return (
    <span
      role="img"
      aria-label={chars}
      className={[
        "inline-flex shrink-0 select-none items-center justify-center rounded-[5px] font-semibold",
        two ? "flex-col leading-[1.02]" : "leading-none",
        SIZE[size],
        tone,
        className,
      ].join(" ")}
      style={{
        fontFamily: SEAL_SERIF,
        background: variant === "seal" ? SEAL_RED : "transparent",
      }}
    >
      {Array.from(chars).map((ch, i) => (
        <span key={i}>{ch}</span>
      ))}
    </span>
  );
}