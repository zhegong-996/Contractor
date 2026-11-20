const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

type Choice = { project: string; projectTitle: string; agent: string; agentTitle: string; engine: string };
type Connection = { name: string; approved: boolean; choices: Choice[] };
type LoginOptions = { oauth?: { label: string; url: string }; password: boolean; workbench?: string; expired?: boolean };

export function runnerConnectPage(cspNonce: string, view?: Connection, error?: string, login: LoginOptions = { password: true }) {
  const errorLine = error ? '<p role="alert">' + escape(error) + '</p>' : '';
  const choices = view?.choices ?? [];
  const projects = new Map<string, Choice[]>();
  for (const item of choices) {
    const group = projects.get(item.project);
    if (group) group.push(item);
    else projects.set(item.project, [item]);
  }
  const describe = (item: Choice) => escape(item.agentTitle + ' · ' + (item.engine === 'codex' ? 'Codex' : 'Claude Code'));
  const value = (item: Choice) => escape(item.project + '/' + item.agent);
  const choice = choices.length === 1 ? '<input type="hidden" name="selection" value="' + value(choices[0]!) + '">'
    + '<dl><dt>项目</dt><dd>' + escape(choices[0]!.projectTitle) + '</dd><dt>Agent</dt><dd>' + escape(choices[0]!.agentTitle) + '</dd></dl>'
    : '<label>项目与 Agent<select name="selection" required><option value="">请选择</option>'
      + [...projects.values()].map(items =>
        '<optgroup label="' + escape(items[0]!.projectTitle) + '">' + items.map(item =>
          '<option value="' + value(item) + '">' + describe(item) + '</option>').join('') + '</optgroup>').join('')
      + '</select></label>';
  const passwordForm = '<form method="post"><input type="hidden" name="action" value="login">'
    + '<label>账号<input name="username" required autocomplete="username"></label>'
    + '<label>密码<input name="password" type="password" required autocomplete="current-password"></label><button>登录</button></form>';
  const enterpriseLink = login.oauth ? '<p><a class="login-link" href="' + escape(login.oauth.url) + '">使用'
    + escape(login.oauth.label) + '登录</a></p>' : '';
  const form = login.expired ? '' : !view
    ? '<p>登录后确认这台设备可以为哪个项目、哪个 Agent 接单。</p>' + enterpriseLink
      + (login.password ? login.oauth ? '<details><summary>使用原账号口令</summary>' + passwordForm + '</details>' : passwordForm
        : login.oauth ? '' : '<p>当前登录渠道暂不可用，请联系管理员。</p>')
    : view.approved ? '<p role="status">回到执行机等待上线，再从项目的「执行设备」查看。</p>'
      + (login.workbench ? '<a class="login-link" href="' + escape(login.workbench) + '">返回工作台</a>' : '')
    : choices.length ? '<form method="post"><input type="hidden" name="action" value="approve">'
      + choice + '<button>确认连接</button></form>'
    : '<p>当前账号没有可连接的项目 Agent。请检查项目权限，以及执行机是否安装了对应 CLI。</p>';
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>连接执行端 · Contractor</title><style nonce="' + cspNonce + '">'
    + 'body{font:16px/1.55 system-ui,sans-serif;background:#f3f7fd;color:#182f4c;margin:0;padding:0 16px}'
    + 'main{max-width:420px;margin:12vh auto;padding:28px;background:white;border:1px solid #dbe6f3;border-radius:12px}'
    + 'form,label{display:grid;gap:8px}form{gap:16px}input,select,button{font:inherit;padding:9px 12px;border:1px solid #b7cbe2;border-radius:8px}'
    + 'dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0;padding:12px;background:#f3f7fd;border-radius:8px}dd{margin:0;overflow-wrap:anywhere}'
    + 'button,.login-link{background:#1763cc;color:white;cursor:pointer}.login-link{display:inline-block;padding:9px 12px;border-radius:8px;text-decoration:none}'
    + 'summary{cursor:pointer;margin-bottom:8px}h1{font-size:25px;margin:0 0 16px}[role=alert]{color:#a62222}</style>'
    + '<main><h1>' + (login.expired ? '连接已过期' : view?.approved ? '连接已批准' : '连接执行设备') + '</h1>'
    + (view ? '<p>设备 <strong>' + escape(view.name) + '</strong></p>' : '')
    + errorLine + form + '</main></html>';
}
