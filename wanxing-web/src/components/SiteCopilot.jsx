// 萬星站点自己的接待副驾（line-reception-teams 2.3）：一行 loader，绑 `wanxing`。
//
// 站点是 hash 路由的四页（介绍/目录/文档/控制台），所以页面上下文递「当前
// hash 视图」而不是 pathname——产品介绍团队靠它知道访客在看哪一页。
// 动词白名单只收站内 hash 视图与站内锚点；站外 URL、`javascript:` 一律拒。
//
// 只挂在内容视图上：`#/embed` 是宿主页里的 widget（不能再套一层副驾），
// `#/console` 是工具面、已登录才可见，不给它再叠一个介绍入口。
import { useEffect } from "react";

const LINE = "wanxing";
const VIEWS = ["#/", "#/catalog", "#/docs", "#/agent", "#/chat"];

function allowed(to) {
  if (to.startsWith("#/") && !to.startsWith("#//")) return true;
  if (to.startsWith("#") && !to.startsWith("#/") && !to.startsWith("#//")) return true;
  return false;
}

export function SiteCopilot({ viewKey }) {
  useEffect(() => {
    const api = (window.WanxingCopilot = window.WanxingCopilot || {});
    api.context = () => ({ line: "萬星", page: window.location.hash || "#/", intent: "产品介绍" });
    api.intents = {
      navigate: (arg) => {
        const to = String(arg ?? "");
        if (!allowed(to)) {
          throw new Error("navigate 只接受站内 hash 视图或锚点");
        }
        window.location.hash = to;
        return { message: `已跳转到 ${to}` };
      },
    };
    api.pushContext?.();
  }, [viewKey]);

  useEffect(() => {
    // 挂载侧开关（line-reception-copilot「挂载与绑定分离」）：置 'off' 即撤下本站
    // 副驾，无需改绑定。撤挂载与解绑是两条独立回滚路径。
    if (String(import.meta.env.VITE_COPILOT_MOUNT || "").toLowerCase() === "off") return;
    const api = (window.WanxingCopilot = window.WanxingCopilot || {});
    if (document.querySelector("iframe[data-wanxing-copilot]")) return;
    if (document.querySelector('script[data-line="' + LINE + '"]')) return;

    const script = document.createElement("script");
    script.src = "/copilot.js";
    script.async = true;
    script.setAttribute("data-line", LINE);
    // 首屏只留 48px 圆钮：介绍页不该一进来就被面板压住。
    script.setAttribute("data-open", "0");
    document.head.appendChild(script);

    return () => {
      document.querySelector("iframe[data-wanxing-copilot]")?.remove();
      script.remove();
      api.__loaderMounted = false;
      delete window.WanxingCopilot;
    };
  }, []);

  return null;
}

export { VIEWS };
