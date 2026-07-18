/* 頁面權限守衛（Kuafuor HK）
 *
 * 用法：喺想鎖嘅頁面 <head> 加一行，列明邊啲角色先入得：
 *   <script src="/assets/guard.js" data-roles="coach,admin"></script>
 *   <script src="/assets/guard.js" data-roles="student,coach,admin"></script>
 *
 * 行為：
 *   - 未登入 → 帶去 /login/?next=本頁
 *   - 登咗入但角色唔啱 → 顯示「未有權限」畫面
 *   - 驗證唔到（網絡問題）→ 封鎖並提示重試（fail closed）
 *
 * 角色喺 Supabase public.profiles.role，只有 admin 可以改（set_user_role RPC）。
 */
(function () {
  var SB_URL = "https://ikzoxrvnpsseyjviawti.supabase.co";
  var SB_KEY = "sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O"; // publishable key — 放喺前端係安全嘅

  // 語言跟登入頁一致（localStorage kf-lang: zh | en）
  var lang = "zh";
  try { lang = localStorage.getItem("kf-lang") || "zh"; } catch (e) {}
  var T = {
    zh: {
      noPerm: "呢個功能你未有權限用",
      noPermDetail: function () { return "你嘅帳戶用唔到呢一頁。有需要請聯絡 Ming。"; },
      verifyFail: "驗證唔到你嘅身份",
      verifyFailDetail: "網絡或者雲端服務暫時有問題，請重新整理再試。",
      goLogin: "去登入頁 →",
    },
    en: {
      noPerm: "You don't have access to this feature",
      noPermDetail: function () { return "This page isn't available on your account. Contact Ming if you need it."; },
      verifyFail: "We couldn't verify your identity",
      verifyFailDetail: "Network or cloud service issue — please refresh and try again.",
      goLogin: "Go to login page →",
    },
  };
  var L = T[lang] || T.zh;

  var script = document.currentScript;
  var roles = (script.getAttribute("data-roles") || "").split(",")
    .map(function (x) { return x.trim(); }).filter(Boolean);
  var loginUrl = script.getAttribute("data-login") || "/login/";

  // 驗證期間先藏住頁面
  var hide = document.createElement("style");
  hide.textContent = "html{visibility:hidden !important}";
  (document.head || document.documentElement).appendChild(hide);

  function blocked(title, detail) {
    function render() {
      // 書卷識別（紅／黑／米白），跟主頁及登入頁一致；淨淺色
      var bg = "#f8f4f4", ink = "#201f1d", mut = "#605d5d", line = "#d7d3d3", accent = "#a83228";
      var serif = "'Lora','Noto Serif TC',serif", head = "'Cormorant Garamond','Noto Serif TC',serif";
      document.body.innerHTML =
        '<div style="font-family:' + serif + ';max-width:420px;margin:80px auto;padding:28px 22px;border:1px solid ' + line + ';border-radius:6px;text-align:center;background:' + bg + ';color:' + ink + '">' +
        '<div style="font-size:2.2rem">🔒</div>' +
        '<h2 style="margin:10px 0 4px;font-size:1.4rem;font-family:' + head + ';font-weight:600">' + title + "</h2>" +
        (detail ? '<p style="color:' + mut + ';font-size:.9rem;line-height:1.6">' + detail + "</p>" : "") +
        '<p style="margin-top:16px"><a href="' + loginUrl + "?next=" + encodeURIComponent(location.pathname + location.search) +
        '" style="color:' + accent + ';font-weight:600;text-decoration:underline;text-underline-offset:3px">' + L.goLogin + "</a></p>" +
        "</div>";
      document.body.style.background = "#f3f2f2";
      document.documentElement.style.visibility = "visible";
      hide.remove();
    }
    if (document.body) render();
    else document.addEventListener("DOMContentLoaded", render);
  }

  (async function () {
    try {
      var mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      var sb = mod.createClient(SB_URL, SB_KEY);
      var sess = (await sb.auth.getSession()).data.session;
      if (!sess) {
        location.replace(loginUrl + "?next=" + encodeURIComponent(location.pathname + location.search));
        return;
      }
      var res = await sb.from("profiles").select("role").eq("id", sess.user.id).single();
      var role = (res.data && res.data.role) || "member";
      if (roles.length === 0 || roles.indexOf(role) >= 0) {
        document.documentElement.setAttribute("data-user-role", role);
        hide.remove();
        return;
      }
      blocked(L.noPerm, L.noPermDetail());
    } catch (e) {
      blocked(L.verifyFail, L.verifyFailDetail);
    }
  })();
})();
