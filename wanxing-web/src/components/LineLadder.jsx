// 寻数产品线阶梯（wanxing-web spec「The site footer carries the five-line
// ladder」）：双字方章 + 汉字数字（一/十/百/千/万，契约 壹=1…萬=10000）+
// 契约线名；萬星行标「当前站点」；每行都是一个通往该线官网线页的链接。
// 方章与数字是品牌记号，不翻译（站点为纯中文站）。
import { SiteMark } from "./SiteMark.jsx";

const LADDER = [
  { slug: "base", mark: "壹座", numeral: "一", name: "寻数·壹座" },
  { slug: "lex", mark: "识律", numeral: "十", name: "寻数·识律" },
  { slug: "wire", mark: "柏讯", numeral: "百", name: "寻数·柏讯" },
  { slug: "facet", mark: "谦面", numeral: "千", name: "寻数·谦面" },
  { slug: "constellation", mark: "萬星", numeral: "万", name: "寻数·萬星" },
];

export function LineLadder() {
  return (
    <ul className="space-y-2">
      {LADDER.map(({ slug, mark, numeral, name }) => {
        const current = slug === "constellation";
        return (
          <li key={slug}>
            <a
              href={`https://www.finddatatech.cloud/zh/products/${slug}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2.5 text-sm transition-colors ${
                current
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              <SiteMark chars={mark} size="sm" variant={current ? "seal" : "outline"} />
              <span className="w-4 text-center text-xs text-slate-500 dark:text-slate-400">{numeral}</span>
              <span>{name}</span>
              {current && (
                <span className="rounded-full border border-slate-300 px-2 py-px text-[10px] leading-4 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  当前站点
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}