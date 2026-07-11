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
  var ROLE_NAMES = { member: "普通會員", student: "學生", coach: "教練", admin: "管理員" };

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
      document.body.innerHTML =
        '<div style="font-family:-apple-system,\'PingFang HK\',\'Noto Sans TC\',sans-serif;max-width:420px;margin:80px auto;padding:28px 22px;border:1px solid #e3e7ec;border-radius:14px;text-align:center;background:#fff;color:#1c2430">' +
        '<div style="font-size:2.2rem">🔒</div>' +
        '<h2 style="margin:10px 0 4px;font-size:1.1rem">' + title + "</h2>" +
        (detail ? '<p style="color:#66707e;font-size:.85rem;line-height:1.6">' + detail + "</p>" : "") +
        '<p style="margin-top:16px"><a href="' + loginUrl + "?next=" + encodeURIComponent(location.pathname + location.search) +
        '" style="color:#d32f2f;font-weight:700;text-decoration:none">去登入頁 →</a></p>' +
        "</div>";
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
      blocked("呢個功能你未有權限用",
        "你而家嘅身份係「" + (ROLE_NAMES[role] || role) + "」，呢頁需要：" +
        roles.map(function (r) { return ROLE_NAMES[r] || r; }).join(" / ") + "。想開通請聯絡 Ming。");
    } catch (e) {
      blocked("驗證唔到你嘅身份", "網絡或者雲端服務暫時有問題，請重新整理再試。");
    }
  })();
})();
